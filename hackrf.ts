/**
 * Main module, contains the USB interfacing code
 * and user-facing API
 */
/** */

import { promisify } from 'util'

import {
	Device, OutEndpoint, LibUSBException,
	getDeviceList, findByIds,
	LIBUSB_ERROR_NOT_SUPPORTED, LIBUSB_ERROR_INTERRUPTED, LIBUSB_TRANSFER_COMPLETED,
	LIBUSB_ENDPOINT_OUT, LIBUSB_ENDPOINT_IN,
	LIBUSB_REQUEST_TYPE_VENDOR, LIBUSB_RECIPIENT_DEVICE, LIBUSB_TRANSFER_TYPE_BULK,
} from 'usb'

import {
	SAMPLES_PER_BLOCK, BYTES_PER_BLOCK, MAX_SWEEP_RANGES,
	BoardId, UsbBoardId, RfPathFilter, OperacakePorts, SweepStyle,
	USB_HACKRF_VID, USB_CONFIG_STANDARD, TransceiverMode, VendorRequest,
	ErrorCode,
} from './constants'

import {
	HackrfError, checkU32, checkU16, checkU8, checkSpiflashAddress,
	checkIFreq, checkLoFreq, checkBasebandFilterBw, checkFreq,
	checkMax2837Reg, checkMax2837Value, checkSi5351cReg, checkSi5351cValue,
	checkRffc5071Reg, checkRffc5071Value, calcSampleRate, checkInLength,
} from './util'

const USB_INTERFACE = 0
const TRANSFER_COUNT = 4
const TRANSFER_BUFFER_SIZE = 262144

function detachKernelDrivers(handle: Device) {
    for (const iface of handle.interfaces) {
        let active: boolean
        try {
            active = iface.isKernelDriverActive()
        } catch (e) {
            if (e instanceof LibUSBException && e.errno === LIBUSB_ERROR_NOT_SUPPORTED)
				return
			throw e
        }
        if (active)
            iface.detachKernelDriver()
    }
}

async function setHackrfConfiguration(handle: Device, config: number) {
	if (handle.getConfiguration() != config) {
		detachKernelDrivers(handle)
		await promisify(cb => handle.setConfiguration(config, cb as any) )()
	}
	detachKernelDrivers(handle)
}

// FIXME: library version & library release

export interface DeviceInfo {
	device: Device
	usbBoardId: number
	serialNumber?: string
}

function isValidDevice(device: Device) {
	const { idVendor, idProduct } = device.deviceDescriptor
	return idVendor === USB_HACKRF_VID &&
		Object.hasOwnProperty.call(UsbBoardId, idProduct)
}

/**
 * Return info about each HackRF device present.
 */
export async function* listDevices() {
    for (const device of getDeviceList().filter(isValidDevice)) {
        const { idProduct, iSerialNumber } = device.deviceDescriptor
		const info: DeviceInfo = { device, usbBoardId: idProduct }
        if (iSerialNumber > 0) {
			try {
				device.open(false)
				// FIXME: original uses libusb_get_string_descriptor_ascii,
				// is there any magic we forgot to replicate?
				info.serialNumber = await promisify(cb =>
					device.getStringDescriptor(iSerialNumber, cb) )() as string
			} catch (e) {
			} finally {
				device.close()
				// FIXME: calling close a second time?
			}
		}
		yield info
	}
}

/**
 * Open the first device whose serial number ends with the passed suffix.
 * If no suffix is passed, open the first device.
 * 
 * @param serialNumber Serial number suffix to match
 */
export async function open(serialNumber?: string): Promise<HackrfDevice> {
	if (serialNumber) {
		for await (const info of listDevices()) {
			if (info.serialNumber?.endsWith(serialNumber))
				return HackrfDevice.open(info.device)
		}
	} else {
		const device =
			findByIds(USB_HACKRF_VID, UsbBoardId.HACKRF_ONE) ||
			findByIds(USB_HACKRF_VID, UsbBoardId.JAWBREAKER) ||
			findByIds(USB_HACKRF_VID, UsbBoardId.RAD1O)
		if (device) return HackrfDevice.open(device)
	}
	throw new HackrfError(ErrorCode.NOT_FOUND)
}

export class HackrfDevice {
	private readonly handle: Device
	private readonly cpldEndpoint: OutEndpoint
	private transfers
	private callback
	private transfer_thread_started = false
	private streaming = false
	private do_exit = false

	/**
	 * Open the passed USB device
	 * 
	 * This function does **not** validate the device,
	 * it's recommended to use the `open` module function
	 * instead of this function directly.
	 * 
	 * @param device USB device to open
	 */
	static async open(device: Device) {
		device.open(false)
		await setHackrfConfiguration(device, USB_CONFIG_STANDARD)
		device.interface(USB_INTERFACE).claim()
		return new HackrfDevice(device)
	}

	private constructor(handle: Device) {
		this.handle = handle
		
		const cpldEndpoint = this.handle.interface(USB_INTERFACE)
			.endpoint(LIBUSB_ENDPOINT_OUT | 2)
		if (!(cpldEndpoint instanceof OutEndpoint))
			throw new HackrfError(ErrorCode.LIBUSB)
		if (cpldEndpoint.transferType !== LIBUSB_TRANSFER_TYPE_BULK)
			throw new HackrfError(ErrorCode.LIBUSB)
		this.cpldEndpoint = cpldEndpoint
	}

	/**
	 * Cancel pending transfers and close the USB device.
	 */
	close() {
		// TODO
	}

	get usbApiVersion() {
		return this.handle.deviceDescriptor.bcdDevice
	}

	private usbApiRequired(version: number) {
		const usbVersion = this.usbApiVersion
		if (usbVersion < version)
			throw new HackrfError(ErrorCode.USB_API_VERSION)
	}

	// CONTROL TRANSFERS

	private controlTransferIn(bRequest: VendorRequest, wValue: number, wIndex: number, length: number): Promise<Buffer> {
		return promisify(cb => this.handle.controlTransfer(
			LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE,
			bRequest, wValue, wIndex, length, cb))() as Promise<Buffer>
	}

	private controlTransferOut(bRequest: VendorRequest, wValue: number, wIndex: number, data: Buffer = Buffer.alloc(0)): Promise<void> {
		return promisify(cb => this.handle.controlTransfer(
			LIBUSB_ENDPOINT_OUT | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE,
			bRequest, wValue, wIndex, data, cb))() as Promise<void>
	}

	protected async setTransceiverMode(value: TransceiverMode) {
		await this.controlTransferOut(VendorRequest.SET_TRANSCEIVER_MODE, value, 0)
	}

	/**
	 * @category Device info
	 */
	async getVersionString() {
		// FIXME: is 64 bytes enough? is encoding correct?
		const buf = await this.controlTransferIn(VendorRequest.VERSION_STRING_READ, 0, 0, 64)
		return buf.toString('utf-8')
	}

	/**
	 * @category Device info
	 */
	async getBoardId() {
		const buf = await this.controlTransferIn(VendorRequest.BOARD_ID_READ, 0, 0, 1)
		return checkInLength(buf, 1).readUInt8() as BoardId
	}

	/**
	 * @category Device info
	 */
	async getBoardPartIdSerialNo() {
		const buf = await this.controlTransferIn(VendorRequest.BOARD_PARTID_SERIALNO_READ, 0, 0, 24)
		checkInLength(buf, 24)
		const u32 = [0,1,2,3,4,5].map(x => buf.readUInt32LE(x * 4))
		return {
			partId: u32.slice(0, 2) as [ number, number ],
			serialNo: u32.slice(2, 6) as [ number, number, number, number ],
		}
	}

	/**
	 * @category IC control
	 */
	async max2837_read(register: number) {
		const buf = await this.controlTransferIn(VendorRequest.MAX2837_READ,
			0, checkMax2837Reg(register), 2)
		return checkInLength(buf, 2).readUInt16LE()
	}

	/**
	 * @category IC control
	 */
	async max2837_write(register: number, value: number) {
		await this.controlTransferOut(VendorRequest.MAX2837_WRITE,
			checkMax2837Value(value), checkMax2837Reg(register))
	}

	/**
	 * @category IC control
	 */
	async si5351c_read(register: number) {
		const buf = await this.controlTransferIn(VendorRequest.SI5351C_READ,
			0, checkSi5351cReg(register), 1)
		return checkInLength(buf, 1).readUInt8()
	}

	/**
	 * @category IC control
	 */
	async si5351c_write(register: number, value: number) {
		await this.controlTransferOut(VendorRequest.SI5351C_WRITE,
			checkSi5351cValue(value), checkSi5351cReg(register))
	}

	/**
	 * @category IC control
	 */
	async rffc5071_read(register: number) {
		const buf = await this.controlTransferIn(VendorRequest.RFFC5071_READ,
			0, checkRffc5071Reg(register), 2)
		return checkInLength(buf, 2).readUInt16LE()
	}
	
	/**
	 * @category IC control
	 */
	async rffc5071_write(register: number, value: number) {
		await this.controlTransferOut(VendorRequest.RFFC5071_WRITE,
			checkRffc5071Value(value), checkRffc5071Reg(register))
	}
	
	/**
	 * @category Flash
	 */
	async spiflash_erase() {
		await this.controlTransferOut(VendorRequest.SPIFLASH_ERASE, 0, 0)
	}

	/**
	 * @category Flash
	 */
	async spiflash_write(address: number, data: Buffer) {
		checkSpiflashAddress(address)
		await this.controlTransferOut(VendorRequest.SPIFLASH_WRITE,
			address >>> 16, address & 0xFFFF, data)
	}
	
	/**
	 * @category Flash
	 */
	async spiflash_read(address: number, length: number) {
		checkSpiflashAddress(address)
		const buf = await this.controlTransferIn(VendorRequest.SPIFLASH_READ,
			address >>> 16, address & 0xFFFF, length)
		return checkInLength(buf, length)
	}
	
	/**
	 * TODO
	 * 
	 * Requires USB API 0x0103.
	 * 
	 * @category Flash
	 */
	async spiflash_getStatus() {
		this.usbApiRequired(0x0103)
		const buf = await this.controlTransferIn(VendorRequest.SPIFLASH_STATUS, 0, 0, 2)
		return checkInLength(buf, 1) // FIXME
	}
	
	/**
	 * TODO
	 * 
	 * Requires USB API 0x0103.
	 * 
	 * @category Flash
	 */
	async spiflash_clearStatus() {
		this.usbApiRequired(0x0103)
		await this.controlTransferOut(VendorRequest.SPIFLASH_CLEAR_STATUS, 0, 0)
	}

	/**
	 * Set baseband filter bandwidth in Hz
	 * 
	 * Possible values: 1.75/2.5/3.5/5/5.5/6/7/8/9/10/12/14/15/20/24/28MHz
	 * 
	 * @category Radio control
	 */
	async setBasebandFilterBandwidth(freqHz: number) {
		checkBasebandFilterBw(checkU32(freqHz))
		await this.controlTransferOut(VendorRequest.BASEBAND_FILTER_BANDWIDTH_SET,
			freqHz & 0xffff, freqHz >>> 16)
	}

	/**
	 * Set the tuning frequency
	 * 
	 * @category Radio control
	 */
	async setFrequency(freqHz: bigint) {
		checkFreq(freqHz)
		// convert Freq Hz 64bits to Freq MHz (32bits) & Freq Hz (32bits)
		const FREQ_ONE_MHZ = BigInt(1000*1000)
		const data = Buffer.alloc(8)
		data.writeUInt32LE(Number(freqHz / FREQ_ONE_MHZ), 0)
		data.writeUInt32LE(Number(freqHz % FREQ_ONE_MHZ), 4)
		await this.controlTransferOut(VendorRequest.SET_FREQ, 0, 0, data)
	}

	/**
	 * Set the tuning frequency (raw version)
	 * 
	 * @param iFreqHz intermediate frequency
	 * @param loFreqHz front-end local oscillator frequency
	 * @param path image rejection filter path
	 * @category Radio control
	 */
	async setFrequencyExplicit(iFreqHz: bigint, loFreqHz: bigint, path: RfPathFilter) {
		checkIFreq(iFreqHz)
		if (path !== RfPathFilter.BYPASS)
			checkLoFreq(loFreqHz)
		if (path > 2)
			throw new HackrfError(ErrorCode.INVALID_PARAM)

		const data = Buffer.alloc(8 + 8 + 1)
		data.writeBigUInt64LE(iFreqHz, 0)
		data.writeBigUInt64LE(loFreqHz, 8)
		data.writeUInt8(path, 16)
		await this.controlTransferOut(VendorRequest.SET_FREQ_EXPLICIT, 0, 0, data)
	}

	/**
	 * Set the sample rate (raw version)
	 * 
	 * You should probably use [[setSampleRate]] instead of this
	 * function.
	 * 
	 * For anti-aliasing, the baseband filter bandwidth is automatically set to the
	 * widest available setting that is no more than 75% of the sample rate.  This
	 * happens every time the sample rate is set.  If you want to override the
	 * baseband filter selection, you must do so after setting the sample rate.
	 * 
	 * 2-20Mhz - as a fraction, i.e. freq 20000000 divider 2 -> 10Mhz
	 * 
	 * @category Radio control
	 */
	async setSampleRateManual(freqHz: number, divider: number) {
		const data = Buffer.alloc(8)
		data.writeUInt32LE(freqHz, 0)
		data.writeUInt32LE(divider, 4)
		await this.controlTransferOut(VendorRequest.SAMPLE_RATE_SET, 0, 0, data)
	}

	/**
	 * Set the sample rate
	 * 
	 * High-level version that uses [[calcSampleRate]] to derive
	 * the frequency and divider.
	 * 
	 * For anti-aliasing, the baseband filter bandwidth is automatically set to the
	 * widest available setting that is no more than 75% of the sample rate.  This
	 * happens every time the sample rate is set.  If you want to override the
	 * baseband filter selection, you must do so after setting the sample rate.
	 * 
	 * @param freqHz frequency in Hz, 2-20MHz (double)
	 * 
	 * @category Radio control
	 */
	async setSampleRate(freqHz: number) {
		const result = calcSampleRate(freqHz)
		return this.setSampleRateManual(result.freq_hz, result.divider)
	}

	/**
	 * Enable / disable RX/TX RF external amplifier
	 * 
	 * @category Radio control
	 */
	async setAmpEnable(value: boolean) {
		await this.controlTransferOut(VendorRequest.AMP_ENABLE, Number(value), 0)
	}

	/**
	 * Set RX LNA (IF) gain, 0-40dB in 8dB steps
	 * 
	 * @category Radio control
	 */
	async setLnaGain(gainDb: number) {
		if (checkU32(gainDb) > 40)
			throw new HackrfError(ErrorCode.INVALID_PARAM)
		gainDb &= ~0x07
		const buf = await this.controlTransferIn(VendorRequest.SET_LNA_GAIN, 0, gainDb, 1)
		if (buf.length != 1 || !buf.readUInt8())
			throw new HackrfError(ErrorCode.INVALID_PARAM)
	}

	/**
	 * Set RX VGA (baseband) gain, 0-62dB in 2dB steps
	 * 
	 * @category Radio control
	 */
	async setVgaGain(gainDb: number) {
		if (checkU32(gainDb) > 62)
			throw new HackrfError(ErrorCode.INVALID_PARAM)
		gainDb &= ~0x01
		const buf = await this.controlTransferIn(VendorRequest.SET_VGA_GAIN, 0, gainDb, 1)
		if (buf.length != 1 || !buf.readUInt8())
			throw new HackrfError(ErrorCode.INVALID_PARAM)
	}

	/**
	 * Set TX VGA (IF) gain, 0-47dB in 1dB steps
	 * 
	 * @category Radio control
	 */
	async setTxVgaGain(gainDb: number) {
		if (checkU32(gainDb) > 47)
			throw new HackrfError(ErrorCode.INVALID_PARAM)
		const buf = await this.controlTransferIn(VendorRequest.SET_TXVGA_GAIN, 0, gainDb, 1)
		if (buf.length != 1 || !buf.readUInt8())
			throw new HackrfError(ErrorCode.INVALID_PARAM)
	}

	/**
	 * Antenna port power control
	 * 
	 * @category Radio control
	 */
	async setAntennaEnable(value: boolean) {
		await this.controlTransferOut(VendorRequest.ANTENNA_ENABLE, Number(value), 0)
	}

	/**
	 * Enable / disable hardware sync
	 * 
	 * Multiple boards can be made to syncronize
	 * their USB transfers through a GPIO connection
	 * between them
	 * 
	 * Requires USB API 0x0102.
	 * 
	 * @category Radio control
	 */
	async setHwSyncMode(value: boolean) {
		this.usbApiRequired(0x0102)
		await this.controlTransferOut(VendorRequest.SET_HW_SYNC_MODE, Number(value), 0)
	}

	/**
	 * Reset the device
	 * 
	 * Requires USB API 0x0102.
	 * 
	 * @category Radio control
	 */
	async reset() {
		this.usbApiRequired(0x0102)
		await this.controlTransferOut(VendorRequest.RESET, 0, 0)
	}

	/**
	 * Initialize sweep mode
	 * 
	 * Requires USB API 0x0102.
	 * 
	 * @param ranges is a list of start/stop pairs of frequencies in MHz,
	 * 	   no more than [[MAX_SWEEP_RANGES]] entries.
	 * @param numBytes the number of sample bytes to capture after each tuning.
	 * @param stepWidth the width in Hz of the tuning step.
	 * @param offset number of Hz added to every tuning frequency.
	 *     Use to select center frequency based on the expected usable bandwidth.
	 * @category Radio control
	 */
	async initSweep(
		ranges: [number, number][], numBytes: number,
		stepWidth: number, offset: number, style: SweepStyle
	) {
		this.usbApiRequired(0x0102)

		if (!( ranges.length >= 1 && ranges.length <= MAX_SWEEP_RANGES ))
			throw new HackrfError(ErrorCode.INVALID_PARAM)

		if(numBytes % BYTES_PER_BLOCK || numBytes < BYTES_PER_BLOCK)
			throw new HackrfError(ErrorCode.INVALID_PARAM)

		if(stepWidth < 1)
			throw new HackrfError(ErrorCode.INVALID_PARAM)

		if(style > 1)
			throw new HackrfError(ErrorCode.INVALID_PARAM)

		const data = Buffer.alloc(9 + ranges.length * 4)
		data.writeUInt32LE(checkU32(stepWidth), 0)
		data.writeUInt32LE(checkU32(offset), 4)
		data.writeUInt8(style, 8)
		ranges.forEach(([start, stop], i) => {
			data.writeUInt16LE(checkU16(start), 9 + i*4)
			data.writeUInt16LE(checkU16(stop), 9 + i*4 + 2)
		})

		checkU32(numBytes)
		await this.controlTransferOut(VendorRequest.INIT_SWEEP,
			numBytes & 0xffff, (numBytes >>> 16) & 0xffff, data)
	}

	/**
	 * Retrieve list of Operacake board addresses (uint8)
	 * 
	 * Requires USB API 0x0102.
	 * 
	 * @category Operacake
	 */
	async getOperacakeBoards() {
		this.usbApiRequired(0x0102)
		const buf = await this.controlTransferIn(VendorRequest.OPERACAKE_GET_BOARDS, 0, 0, 8)
		return Array.from(checkInLength(buf, 8))
	}

	/**
	 * Set Operacake ports
	 * 
	 * Requires USB API 0x0102.
	 * 
	 * @category Operacake
	 */
	async setOperacakePorts(address: number, portA: OperacakePorts, portB: OperacakePorts) {
		this.usbApiRequired(0x0102)

		if(checkU32(portA) > OperacakePorts.PB4 || checkU32(portB) > OperacakePorts.PB4)
			throw new HackrfError(ErrorCode.INVALID_PARAM)

		// Check which side PA and PB are on
		if ((portA <= OperacakePorts.PA4 && portB <= OperacakePorts.PA4) ||
			(portA > OperacakePorts.PA4 && portB > OperacakePorts.PA4))
			throw new HackrfError(ErrorCode.INVALID_PARAM)

		await this.controlTransferOut(VendorRequest.OPERACAKE_SET_PORTS,
			checkU8(address), portA | (portB << 8))
	}

	/**
	 * TODO
	 * 
	 * Requires USB API 0x0103.
	 * 
	 * @category Operacake
	 */
	async setOperacakeRanges(ranges: Buffer) {
		this.usbApiRequired(0x0103)
		await this.controlTransferOut(VendorRequest.OPERACAKE_SET_RANGES, 0, 0, ranges)
	}

	/**
	 * Returns test result (uint16)
	 * 
	 * Requires USB API 0x0103.
	 * 
	 * @category Operacake
	 */
	async operacakeGpioTest(address: number) {
		this.usbApiRequired(0x0103)
		const buf = await this.controlTransferIn(VendorRequest.OPERACAKE_GPIO_TEST, address, 0, 2)
		return checkInLength(buf, 1) // FIXME
	}

	/**
	 * TODO
	 * 
	 * Requires USB API 0x0103.
	 * 
	 * @category Radio control
	 */
	async setClkoutEnable(value: boolean) {
		this.usbApiRequired(0x0103)
		await this.controlTransferOut(VendorRequest.CLKOUT_ENABLE, Number(value), 0);
	}

	// FIXME: only for HACKRF_ISSUE_609_IS_FIXED
	/**
	 * Returns crc32 (uint32)
	 * 
	 * Requires USB API 0x0103.
	 * 
	 * @category CPLD
	 */
	async cpld_checksum() {
		this.usbApiRequired(0x0103)
		const buf = await this.controlTransferIn(VendorRequest.CPLD_CHECKSUM, 0, 0, 4)
		return checkInLength(buf, 4).readUInt32LE()
	}

	/**
	 * TODO
	 * 
	 * Requires USB API 0x0104.
	 * 
	 * @category Radio control
	 */
	async setUiEnable(value: boolean) {
		this.usbApiRequired(0x0104)
		await this.controlTransferOut(VendorRequest.UI_ENABLE, Number(value), 0)
	}

	// OTHER TRANSFERS

	/**
	 * TODO
	 * 
	 * device will need to be reset after this
	 * 
	 * @category CPLD
	 */
	async cpld_write(data: Buffer) {
		await this.setTransceiverMode(TransceiverMode.CPLD_UPDATE)
		const chunkSize = 512
		for (let i = 0; i < data.length; i += chunkSize)
			await promisify(cb => this.cpldEndpoint.transfer(
				data.slice(i, i + chunkSize), cb as any) )()
	}
	
	// TODO: rx start & end
}

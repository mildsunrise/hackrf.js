/**
 * Enums and constants
 * @module
 */

export const SAMPLES_PER_BLOCK = 8192
export const BYTES_PER_BLOCK = 16384
export const MAX_SWEEP_RANGES = 10

export enum ErrorCode {
	/** invalid parameter(s) */
	INVALID_PARAM = -2,
	/** HackRF not found */
	NOT_FOUND = -5,
	/** HackRF busy */
	BUSY = -6,
	/** insufficient memory */
	NO_MEM = -11,
	/** USB error */
	LIBUSB = -1000,
	/** transfer thread error */
	THREAD = -1001,
	/** streaming thread encountered an error */
	STREAMING_THREAD_ERR = -1002,
	/** streaming stopped */
	STREAMING_STOPPED = -1003,
	/** streaming terminated */
	STREAMING_EXIT_CALLED = -1004,
	/** feature not supported by installed firmware */
	USB_API_VERSION = -1005,
	/** one or more HackRFs still in use */
	NOT_LAST_DEVICE = -2000,
	/** unspecified error */
	OTHER = -9999,
}

export const errorMessages: { [code: number]: string } = {
	[ErrorCode.INVALID_PARAM]: 'invalid parameter(s)',
	[ErrorCode.NOT_FOUND]: 'HackRF not found',
	[ErrorCode.BUSY]: 'HackRF busy',
	[ErrorCode.NO_MEM]: 'insufficient memory',
	[ErrorCode.LIBUSB]: 'USB error',
	[ErrorCode.THREAD]: 'transfer thread error',
	[ErrorCode.STREAMING_THREAD_ERR]: 'streaming thread encountered an error',
	[ErrorCode.STREAMING_STOPPED]: 'streaming stopped',
	[ErrorCode.STREAMING_EXIT_CALLED]: 'streaming terminated',
	[ErrorCode.USB_API_VERSION]: 'feature not supported by installed firmware',
	[ErrorCode.NOT_LAST_DEVICE]: 'one or more HackRFs still in use',
	[ErrorCode.OTHER]: 'unspecified error',
}

export enum BoardId {
	JELLYBEAN = 0,
	JAWBREAKER = 1,
	HACKRF_ONE = 2,
	RAD1O = 3,
}

export const boardIdNames: { [boardId: number]: string } = {
	[BoardId.JELLYBEAN]: 'Jellybean',
	[BoardId.JAWBREAKER]: 'Jawbreaker',
	[BoardId.HACKRF_ONE]: 'HackRF One',
	[BoardId.RAD1O]: 'rad1o',
}

/** USB PIDs */
export enum UsbBoardId {
	JAWBREAKER = 0x604B,
	HACKRF_ONE = 0x6089,
	RAD1O = 0xCC15,
}

export const usbBoardIdNames: { [usbBoardId: number]: string } = {
	[UsbBoardId.JAWBREAKER]: 'Jawbreaker',
	[UsbBoardId.HACKRF_ONE]: 'HackRF One',
	[UsbBoardId.RAD1O]: 'rad1o',
}

export enum RfPathFilter {
	/** mixer bypass */
	BYPASS = 0,
	/** low pass filter */
	LOW_PASS = 1,
	/** high pass filter */
	HIGH_PASS = 2,
}

export const rfPathFilterNames: { [rfPathFilter: number]: string } = {
	[RfPathFilter.BYPASS]: 'mixer bypass',
	[RfPathFilter.LOW_PASS]: 'low pass filter',
	[RfPathFilter.HIGH_PASS]: 'high pass filter',
}

export enum OperacakePorts {
	PA1 = 0,
	PA2 = 1,
	PA3 = 2,
	PA4 = 3,
	PB1 = 4,
	PB2 = 5,
	PB3 = 6,
	PB4 = 7,
}

export enum SweepStyle {
	/**
	 * `stepWidth` is added to the current frequency at each step
	 */
	LINEAR = 0,
	/**
	 * invokes a scheme in which each step is divided into two
	 * interleaved sub-steps, allowing the host to select the best portions
	 * of the FFT of each sub-step and discard the rest.
	 */
	INTERLEAVED = 1,
}

// INTERNAL

export const FREQ_HZ_MIN = 0
/** 7250MHz */
export const FREQ_HZ_MAX = 7250000000
export const IF_HZ_MIN = 2150000000
export const IF_HZ_MAX = 2750000000
export const LO_FREQ_HZ_MIN = 84375000
export const LO_FREQ_HZ_MAX = 5400000000

/** 1.75 MHz min value */
export const BASEBAND_FILTER_BW_MIN = 1750000
/** 28 MHz max value */
export const BASEBAND_FILTER_BW_MAX = 28000000

export const USB_HACKRF_VID = 0x1d50
export const USB_CONFIG_STANDARD = 0x1
export const USB_MAX_SERIAL_LENGTH = 32

export enum VendorRequest {
	SET_TRANSCEIVER_MODE = 1,
	MAX2837_WRITE = 2,
	MAX2837_READ = 3,
	SI5351C_WRITE = 4,
	SI5351C_READ = 5,
	SAMPLE_RATE_SET = 6,
	BASEBAND_FILTER_BANDWIDTH_SET = 7,
	RFFC5071_WRITE = 8,
	RFFC5071_READ = 9,
	SPIFLASH_ERASE = 10,
	SPIFLASH_WRITE = 11,
	SPIFLASH_READ = 12,
	BOARD_ID_READ = 14,
	VERSION_STRING_READ = 15,
	SET_FREQ = 16,
	AMP_ENABLE = 17,
	BOARD_PARTID_SERIALNO_READ = 18,
	SET_LNA_GAIN = 19,
	SET_VGA_GAIN = 20,
	SET_TXVGA_GAIN = 21,
	ANTENNA_ENABLE = 23,
	SET_FREQ_EXPLICIT = 24,
	USB_WCID_VENDOR_REQ = 25,
	INIT_SWEEP = 26,
	OPERACAKE_GET_BOARDS = 27,
	OPERACAKE_SET_PORTS = 28,
	SET_HW_SYNC_MODE = 29,
	RESET = 30,
	OPERACAKE_SET_RANGES = 31,
	CLKOUT_ENABLE = 32,
	SPIFLASH_STATUS = 33,
	SPIFLASH_CLEAR_STATUS = 34,
	OPERACAKE_GPIO_TEST = 35,
	CPLD_CHECKSUM = 36,
	UI_ENABLE = 37,
}

export enum TransceiverMode {
	OFF = 0,
	RECEIVE = 1,
	TRANSMIT = 2,
	SS = 3,
	CPLD_UPDATE = 4,
	RX_SWEEP = 5,
}

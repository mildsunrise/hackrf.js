/*
 * Testing sequence for the HackRF.
 *
 * Initially just test the noise floor at a range of frequencies.
 * Noise floor is simplified to just the variance in the magnitude of the I/Q vectors.
 */
import { open, HackrfDevice, DeviceInfo, UsbBoardId } from '../lib'

import { reception_test } from "./reception_test"

type Complex = [number, number]

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/*
 * Not really an FFT, not yet. But aspiring to be
 */
class FFT {
    protected num_samples: number = 0;
    protected sum_mag: number = 0;
    protected sum_mag_squared: number = 0;

    constructor(_logSize: number) {
	// Allocate array of size 2^_logSize
    }

    accumulate(x: Complex): void {
	const mag_squared = x[0]*x[0] + x[1]*x[1]
	this.sum_mag_squared += mag_squared;
	this.num_samples++;
    }

    noise_floor(): number
    {
	return Math.sqrt(this.sum_mag_squared/this.num_samples);
    }
}

async function noise_floor_test(dut: HackrfDevice, frequency: number, sample_rate: number): Promise<number> {
    console.log(`Measuring noise floor at ${frequency}`)

    const num_seconds = 1;

    await dut.setFrequency(frequency)
    await dut.setSampleRate(sample_rate)
    await dut.setAmpEnable(false)
    await dut.setLnaGain(32)
    await dut.setVgaGain(48)

    var fft = new FFT(12);
    var num_samples = 0;
    await dut.receive((array): undefined | void | false => {
	if (num_samples >= num_seconds*sample_rate)
	    return;	// Discard overrun
	const samples = array.length / 2
	for (let n = 0; n < samples; n++)
	{
	    if (++num_samples == num_seconds*sample_rate) {     // Collect 1 second of data
		dut.requestStop();
		break;
	    }
	    const i = array[n * 2 + 0] / 127
	    const q = array[n * 2 + 1] / 127
	    fft.accumulate([i, q])
	}
    })
    return fft.noise_floor();
}

export async function run_test_sequence(rig_info: DeviceInfo, dut_info: DeviceInfo)
{
    const rig: HackrfDevice = await open(rig_info.serialNumber)
    if (!rig)
	return `rig ${rig_info.serialNumber} not available`;

    const dut: HackrfDevice = await open(dut_info.serialNumber)
    if (!dut)
	return `HackRF ${dut_info.serialNumber} not available`;

    console.log(`Testing ${dut_info.serialNumber} using ${rig_info.serialNumber}:\n`);

    const frequencies = [80e6, 600e6, 2.4e9, 3.6e9]
    for (let i = 0; i < frequencies.length; i++) {
	const frequency = frequencies[i];
	var noise_floor = await noise_floor_test(dut, frequency, 1.2e6);
	console.log(`Noise floor at ${frequency/1e6} is ${Math.round(noise_floor*1280)/10}`)
    }

    var frequency = frequencies[0];
    var receive_result = await reception_test(rig, dut, frequency);
    console.log(`Reception at ${frequency/1e6} returned ${receive_result}`)
}

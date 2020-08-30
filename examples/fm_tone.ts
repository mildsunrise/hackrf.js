/**
 * Transmit a tone through FM radio.
 */

import { open } from '..'

async function main() {
	const fs = 2e6
	const carrierFrequency = 97e6
	const carrierAmplitude = 1
	const carrierDeviation = 75e3  // 150kHz bandwidth
	const toneFrequency = 400
	const toneAmplitude = .4

	const device = await open()
	await device.setFrequency(carrierFrequency)
	await device.setSampleRate(fs)
	await device.setAmpEnable(false)
	await device.setTxVgaGain(30)

	const tone = makeToneGeneratorF(fs, toneFrequency, toneAmplitude)
	const modulator = makeFrequencyMod(fs, carrierDeviation, carrierAmplitude)
	const signal = () => quantize( modulator(tone()) )

	console.log(`Transmitting at ${(carrierFrequency/1e6).toFixed(2)}MHz...`)
	process.on('SIGINT', () => device.requestStop())
	await device.transmit(array => {
		const samples = array.length / 2
		for (let n = 0; n < samples; n++)
			array.set(signal(), n * 2)
	})
	console.log('\nDone, exiting')
}
main()

type Complex = [number, number]
const TAU = 2 * Math.PI

function makeToneGeneratorF(fs: number, frequency: number, amplitude: number = 1) {
	let phase = 0
	const delta = (TAU * Math.abs(frequency) / fs) % TAU
	return () => {
		phase += delta
		phase > TAU && (phase -= TAU)
		return amplitude * Math.cos(phase)
	}
}

function makeFrequencyMod(fs: number, maxDeviation: number, amplitude: number = 1) {
	let phase = 0
	const delta = TAU * maxDeviation / fs
	return (x: number): Complex => {
		phase = (phase + delta * x) % TAU
		return [ amplitude * Math.cos(phase), amplitude * Math.sin(phase) ]
	}
}

const quantize = ([i, q]: Complex): Complex =>
	[ Math.round(i * 127), Math.round(q * 127) ]

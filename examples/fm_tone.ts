/**
 * Transmit a tone through FM radio.
 */

import { open } from '..'
const TAU = 2 * Math.PI

async function main() {
	const fs = 2e6
	const carrierFrequency = 97e6
	const carrierAmplitude = 1
	const carrierDeviation = 75e3  // 150kHz bandwidth
	const toneFrequency = 400
	const toneAmplitude = .4

	const device = await open()
	await device.setFrequency(carrierFrequency)
	await device.setAmpEnable(false)
	await device.setTxVgaGain(30)
	await device.setSampleRate(fs)

	console.log(`Transmitting at ${(carrierFrequency/1e6).toFixed(2)}MHz...`)
	const tone = makeToneGenerator(fs, toneFrequency, toneAmplitude)
	const modulator = makeFreqModulator(fs, carrierDeviation, carrierAmplitude * 127)
	process.on('SIGINT', () => device.requestStop())
	await device.transmit(buffer => {
		const samples = buffer.length / 2
		for (let n = 0; n < samples; n++)
			[ buffer[n * 2 + 0], buffer[n * 2 + 1] ] = modulator(tone())
	})
	console.log('\nDone, exiting')
}
main()

type Complex = [number, number]

function makeBlock<O, I=void>(func: () => Iterator<O, void, I>): (x: I) => O {
	const gen = func()
	return (x) => (gen.next(x).value as O)
}

const makeToneGenerator = (fs: number, frequency: number, amplitude: number = 1) => makeBlock<number>(function*() {
	let phase = 0
	const delta = (TAU * Math.abs(frequency) / fs) % TAU
	while (true) {
		yield amplitude * Math.cos(phase)
		phase += delta
		phase > TAU && (phase -= TAU)
	}
})

const makeFreqModulator = (fs: number, maxDeviation: number, amplitude: number = 1) => makeBlock<Complex, number>(function*() {
	let phase = 0
	const delta = TAU * maxDeviation / fs
	while (true) {
		const next = yield [ amplitude * Math.cos(phase), amplitude * Math.sin(phase) ]
		phase = (phase + delta * next) % TAU
	}
})

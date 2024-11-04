/**
 * Play a sound file through FM radio.
 *
 * Again, very basic example (no preemphasis filter, no
 * stereo, etc). Requires the ffmpeg tool to be present.
 */

import { open } from '../lib'
import { once, EventEmitter } from 'events'
import { promises as fsPromises } from 'fs'
import { Readable } from 'stream'
import { spawn } from 'child_process'

async function main() {
	const fs = 1.2e6
	const carrierFrequency = 97e6
	const carrierAmplitude = 1
	const carrierDeviation = 75e3  // 150kHz bandwidth
	const audioFilename = process.argv[2]

	const device = await open()
	await device.setFrequency(carrierFrequency)
	await device.setSampleRate(fs)
	await device.setAmpEnable(false)
	await device.setTxVgaGain(30)

	// spawn ffmpeg to decode the audio file and downmix to mono
	const audioFile = await fsPromises.open(audioFilename, 'r')
	const ffmpeg = spawn('ffmpeg -i - -ac 1 -ar 48000 -f f32le -',
		{ shell: true, stdio: [ audioFile.fd, 'pipe', 'inherit' ] })
	const audioBuffer = new StreamBuffer(ffmpeg.stdout!, 4 * 4 * 48000)
	let underflowWarnTimer: any
	const getSample = () => {
		if (audioBuffer.queueSize < 4) {
			if (!audioBuffer.complete && !underflowWarnTimer) {
				console.warn('audio underflow')
				underflowWarnTimer = setTimeout(() => underflowWarnTimer = null, 100)
			}
			return 0
		}
		return audioBuffer.read(4).readFloatLE()
	}

	// DSP chain (upsample to fs, FM-modulate)
	const interpolator = makeInterpolatorF(getSample, 5)
	const antialiasingFilter = makeFirF(lowPassTaps(48e3 * 5, 19e3, 5e3, 40))
	const interpolator2 = makeInterpolatorF(() => antialiasingFilter(interpolator()), 5)
	const antialiasingFilter2 = makeFirF(lowPassTaps(fs, 19e3, 24e3 * 5 - 19e3, 40))
	const modulator = makeFrequencyMod(fs, carrierDeviation, carrierAmplitude)
	const signal = () => quantize( modulator( antialiasingFilter2(interpolator2()) ) )

	// wait for buffer to fill
	const conversion = once(ffmpeg, 'exit').then(([ code, signal ]) =>
		(code || signal) && Promise.reject(Error('ffmpeg conversion failed')))
	await Promise.race([ conversion, once(audioBuffer, 'fill') ])

	console.log(`Transmitting at ${(carrierFrequency/1e6).toFixed(2)}MHz...`)
	process.on('SIGINT', () => device.requestStop())
	const transmission = device.transmit((array : Int8Array) => {
		if (audioBuffer.complete && audioBuffer.queueSize === 0)
			return false
		const samples = array.length / 2
		for (let n = 0; n < samples; n++)
			array.set(signal(), n * 2)
	})
	await new Promise((resolve, reject) => {
		transmission.then(resolve, reject)
		conversion.catch(reject)
	})
		.finally(() => !(ffmpeg.exitCode || ffmpeg.signalCode) && ffmpeg.kill())
		.finally(() => (device.requestStop(), transmission))
	console.log('\nDone, exiting')
}
main()

type Complex = [number, number]
const PI = Math.PI, TAU = PI * 2
const sinc = (x: number) => x !== 0 ? Math.sin(x) / x : 1

function makeInterpolatorF(input: () => number, n: number) {
	let pos = 0
	return () => {
		pos = (pos + 1) % n
		return pos === 0 ? input() : 0
	}
}

function lowPassTaps(fs: number, cutoffFreq: number, transitionWidth: number, attenuation: number) {
	const window = (x: number) => 0.54 - 0.46 * Math.cos(TAU * x) // hamming window

	let ntaps = Math.floor(attenuation / (22 * transitionWidth / fs))
	if ((ntaps % 2) === 0) ntaps++

	const M = (ntaps - 1) / 2
	const omega = 2 * cutoffFreq / fs
	const taps = [...Array(ntaps)].map((_, n) =>
		window(n / (ntaps - 1)) * omega * sinc(PI * omega * (n - M)) )

	const gain = 1 / taps.reduce((a, b) => a + b)
	return taps.map(x => gain * x)
}

export function makeFirF(taps: number[]) {
	const hs = Float64Array.from(taps).reverse()
	const xs = new Float64Array(taps.length)
	let start = 0
	return (x: number): number => {
		xs[start] = x
		start = (start + 1) % taps.length

		let y = 0
		for (let i = 0; i < taps.length; i++)
			y += hs[i] * xs[(start + i) % taps.length]
		return y
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



class StreamBuffer extends EventEmitter {
	readonly readable: Readable
	readonly maxSize: number
	queue: Buffer[] = []
	queueSize = 0
	complete = false
	constructor(readable: Readable, maxSize: number) {
		super()
		this.readable = readable
		this.maxSize = maxSize
		readable.on('data', (chunk: Buffer) => {
			this.queue.push(chunk)
			this.queueSize += chunk.length
			if (this.queueSize >= maxSize) {
				readable.pause()
				this.emit('fill')
			}
		}).on('end', () => {
			this.complete = true
		})
	}
	read(n: number) {
		if (this.queueSize < n) throw Error()
		if (this.queueSize >= this.maxSize && this.queueSize - n < this.maxSize)
			this.readable.resume()
		const chunks: Buffer[] = []
		while (n) {
			const chunk = this.queue[0].subarray(0, n)
			this.queueSize -= chunk.length
			this.queue[0] = this.queue[0].subarray(chunk.length)
			if (!this.queue[0].length) this.queue.shift()

			n -= chunk.length
			chunks.push(chunk)
		}
		return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
	}
}

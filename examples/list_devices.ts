
import { listDevices, UsbBoardId } from '../lib'

async function main() {
    let ld = listDevices();
    for await (const info of ld) {
	console.log(info.device)  // Show USB detail
	console.log(`Found ${UsbBoardId[info.usbBoardId]} (PID 0x${info.usbBoardId.toString(16).padStart(4, '0')})`)
	if (info.serialNumber) {
	  console.log(`Serial: ${info.serialNumber.replace(/^1+/,'')}`)
	}
	if (info.boardRev !== undefined) {
	  console.log(`Board Rev ${info.boardRev}`)
	}
    }

    process.exit(0)
}
main()

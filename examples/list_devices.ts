
import { listDevices, UsbBoardId } from '../lib'

async function main() {
    let ld = listDevices();
    console.log(ld)
    for await (const info of ld) {
	console.log(info.device)
	console.log(`Found ${info.usbBoardId} = ${UsbBoardId[info.usbBoardId]}`)
	console.log(`Serial: ${info.serialNumber}`)
    }

    process.exit(0)
}
main()

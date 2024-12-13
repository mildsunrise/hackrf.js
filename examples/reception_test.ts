import { HackrfDevice } from '../lib'

export async function reception_test(rig: HackrfDevice, dut: HackrfDevice, frequency: number): Promise<number> {
    console.log(`Testing reception at ${frequency}`)

    // REVISIT: Implement receiver test
    return 0;
}

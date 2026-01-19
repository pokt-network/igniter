import { cleanEnv, num, str, makeValidator } from 'envalid';

const poktAddress = makeValidator<string>((input) => {
    const poktAddressRegex = /^pokt1[a-z0-9]{38,43}$/;
    if (!poktAddressRegex.test(input)) {
        throw new Error(`Invalid POKT bech32 address. Expected format: pokt1... (e.g., pokt1abc123...). Received: ${input.substring(0, 10)}...`);
    }
    return input;
});

export const env = cleanEnv(process.env, {
    MINIMUM_STAKE_BUFFER: num({
        desc: 'Indicates the buffer that has been removed from minimum stake on chain to allow nodes to operate after slashes. This amount is in uPOKT',
        default: 500000000
    }),
    OWNER_IDENTITY: poktAddress({
        desc: 'The user identity of the owner of the provider app. Must be a valid POKT bech32 address (e.g., pokt1abc123...).',
    }),
    APP_IDENTITY: str({
        desc: 'The private key for the governance identity of the provider app. This is expected to be a hex string.',
    })
});

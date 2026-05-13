import { generateKeyPair, exportPKCS8 } from "jose";

const kid = process.argv[2] ?? `lms-platform-${new Date().toISOString().slice(0, 10)}`;
const { privateKey } = await generateKeyPair("RS256", { extractable: true });
const pem = await exportPKCS8(privateKey);
const escapedPem = pem.replace(/\r?\n/g, "\\n");

console.log(`LTI_PLATFORM_KID=${kid}`);
console.log(`LTI_PLATFORM_PRIVATE_KEY_PEM="${escapedPem}"`);

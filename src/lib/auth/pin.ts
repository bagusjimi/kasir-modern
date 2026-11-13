const PBKDF2_ITERATIONS = 100_000;
const HASH_PREFIX = 'pbkdf2';
const SALT_LENGTH = 16;

function toHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function fromHex(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

export function isHashedPin(pin: string): boolean {
	return typeof pin === 'string' && pin.startsWith(`${HASH_PREFIX}$`);
}

async function derivePin(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pin),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		keyMaterial,
		256
	);
	return toHex(bits);
}

export async function hashPin(pin: string, iterations: number = PBKDF2_ITERATIONS): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const hash = await derivePin(pin, salt, iterations);
	return `${HASH_PREFIX}$${iterations}$${toHex(salt.buffer as ArrayBuffer)}$${hash}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
	if (!stored) return false;

	if (!isHashedPin(stored)) {
		return pin === stored;
	}

	const [, iterStr, saltHex, hashHex] = stored.split('$');
	const iterations = Number(iterStr);
	if (!iterations || !saltHex || !hashHex) return false;

	const computed = await derivePin(pin, fromHex(saltHex), iterations);
	return computed === hashHex;
}

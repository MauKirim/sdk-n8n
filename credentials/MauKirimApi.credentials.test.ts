import { createServer } from 'node:http';

import { MauKirimApi } from './MauKirimApi.credentials';

it('accepts a notification-only API key without requiring read access', async () => {
	const server = createServer((request, response) => {
		// The notification key can identify its account, but cannot list rented devices.
		if (request.headers.authorization !== 'Bearer notification-only-key') {
			response.writeHead(401).end();
		} else if (request.url === '/api/v1/account') {
			response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
		} else {
			response.writeHead(403, { 'Content-Type': 'application/json' })
				.end('{"ok":false,"code":"api_key_scope_denied"}');
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

	try {
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('No test server port');
		const test = new MauKirimApi().test.request;
		const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${test.url}`, {
			method: test.method,
			headers: { Authorization: 'Bearer notification-only-key' },
		});
		expect(response.status).toBe(200);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => error ? reject(error) : resolve()),
		);
	}
});

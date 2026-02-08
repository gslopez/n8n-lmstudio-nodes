/**
 * Integration tests -- require a running LM Studio server.
 *
 * Run with: LM_STUDIO_URL=http://localhost:1234 npm run test:integration
 *
 * These are skipped automatically when LM_STUDIO_URL is not set.
 */
import * as http from 'http';
import * as https from 'https';
import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { LmStudioSimpleMessage } from '../../nodes/LMStudioSimpleMessage/LmStudioSimpleMessage.node';

const LM_STUDIO_URL = process.env.LM_STUDIO_URL;
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || 'qwen/qwen3-4b-2507';
const describeIf = LM_STUDIO_URL ? describe : describe.skip;

// A real HTTP helper that mimics this.helpers.httpRequest() enough for our node
function realHttpRequest(options: {
	method?: string;
	url: string;
	headers?: Record<string, string>;
	body?: unknown;
	json?: boolean;
	timeout?: number;
}): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const url = new URL(options.url);
		const transport = url.protocol === 'https:' ? https : http;
		const bodyStr = options.body ? JSON.stringify(options.body) : undefined;

		const req = transport.request(
			{
				hostname: url.hostname,
				port: url.port,
				path: url.pathname + url.search,
				method: options.method ?? 'GET',
				headers: {
					...options.headers,
					...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
				},
				timeout: options.timeout,
			},
			(res) => {
				let data = '';
				res.on('data', (chunk: Buffer) => (data += chunk.toString()));
				res.on('end', () => {
					try {
						resolve(options.json ? JSON.parse(data) : data);
					} catch {
						resolve(data);
					}
				});
			},
		);
		req.on('error', reject);
		if (bodyStr) req.write(bodyStr);
		req.end();
	});
}

// Shared mock builder that uses real HTTP
function createRealExecuteMock(params: Record<string, unknown> = {}) {
	const defaults: Record<string, unknown> = {
		modelName: '',
		message: 'Say hi in one word.',
		temperature: 0.1,
		maxTokens: 50,
		timeout: 60,
		jsonSchema: '{}',
	};
	const merged = { ...defaults, ...params };

	return {
		getInputData: jest.fn().mockReturnValue([{ json: {} }]),
		getNodeParameter: jest.fn().mockImplementation(
			(name: string, _i: number, fallback?: unknown) => merged[name] ?? fallback,
		),
		getNode: jest.fn().mockReturnValue({
			id: 'int-test',
			name: 'Integration Test',
			type: 'test',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getCredentials: jest.fn().mockResolvedValue({ hostUrl: LM_STUDIO_URL, apiKey: '' }),
		getExecutionId: jest.fn().mockReturnValue('int-exec-1'),
		getExecutionCancelSignal: jest.fn().mockReturnValue(undefined),
		continueOnFail: jest.fn().mockReturnValue(false),
		logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
		helpers: { httpRequest: jest.fn().mockImplementation(realHttpRequest) },
	} as unknown as IExecuteFunctions;
}

describeIf('LmStudioSimpleMessage (integration)', () => {
	let node: LmStudioSimpleMessage;

	beforeAll(() => {
		node = new LmStudioSimpleMessage();
	});

	it('getModels returns real models from LM Studio', async () => {
		const mock = {
			getCredentials: jest.fn().mockResolvedValue({ hostUrl: LM_STUDIO_URL, apiKey: '' }),
			helpers: { httpRequest: jest.fn().mockImplementation(realHttpRequest) },
		} as unknown as ILoadOptionsFunctions;

		const models = await node.methods.loadOptions.getModels.call(mock);

		expect(models.length).toBeGreaterThan(0);
		expect(models[0]).toHaveProperty('name');
		expect(models[0]).toHaveProperty('value');
	});

	it('sends a message and gets a text response', async () => {
		const mock = createRealExecuteMock({ modelName: LM_STUDIO_MODEL });

		const result = await node.execute.call(mock);

		expect(result[0]).toHaveLength(1);
		expect(typeof result[0][0].json.response).toBe('string');
		expect((result[0][0].json.response as string).length).toBeGreaterThan(0);
		expect(result[0][0].json._metadata).toHaveProperty('model');
		expect(result[0][0].json._metadata).toHaveProperty('usage');
	}, 120_000);

	it('returns structured JSON when schema is provided', async () => {
		const schema = JSON.stringify({
			type: 'object',
			properties: {
				greeting: { type: 'string' },
			},
			required: ['greeting'],
		});
		const mock = createRealExecuteMock({
			modelName: LM_STUDIO_MODEL,
			message: 'Return a greeting.',
			jsonSchema: schema,
		});

		const result = await node.execute.call(mock);

		expect(result[0][0].json.response).toHaveProperty('greeting');
		expect(typeof (result[0][0].json.response as Record<string, unknown>).greeting).toBe(
			'string',
		);
	}, 120_000);
});

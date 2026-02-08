import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { LmStudioSimpleMessage } from '../../nodes/LMStudioSimpleMessage/LmStudioSimpleMessage.node';

// --- Helpers ---

const mockNode = {
    id: 'test-id',
    name: 'LM Studio Test',
    type: 'n8n-nodes-lmstudio.lmStudioSimpleMessage',
    typeVersion: 1,
    position: [0, 0] as [number, number],
    parameters: {},
};

const defaultCredentials = { hostUrl: 'http://localhost:1234', apiKey: '' };

const chatResponse = (
    content: string,
    extra?: Partial<{ model: string; finish_reason: string }>,
) => ({
    choices: [{ message: { content }, finish_reason: extra?.finish_reason ?? 'stop' }],
    model: extra?.model ?? 'test-model',
    usage: { prompt_tokens: 5, completion_tokens: 10 },
    created: 1700000000,
    id: 'chatcmpl-abc',
});

function createExecuteMock(
    paramOverrides: Record<string, unknown> = {},
    credentialOverrides: Record<string, unknown> = {},
) {
    const defaults: Record<string, unknown> = {
        modelName: 'test-model',
        message: 'Hello',
        temperature: 0.7,
        maxTokens: '',
        timeout: 0,
        jsonSchema: '{}',
    };
    const params = { ...defaults, ...paramOverrides };
    const creds = { ...defaultCredentials, ...credentialOverrides };

    return {
        getInputData: jest.fn().mockReturnValue([{ json: {} }]),
        getNodeParameter: jest
            .fn()
            .mockImplementation(
                (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
            ),
        getNode: jest.fn().mockReturnValue(mockNode),
        getCredentials: jest.fn().mockResolvedValue(creds),
        getExecutionId: jest.fn().mockReturnValue('exec-123'),
        getExecutionCancelSignal: jest.fn().mockReturnValue(undefined),
        continueOnFail: jest.fn().mockReturnValue(false),
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        helpers: { httpRequest: jest.fn() },
    } as unknown as IExecuteFunctions;
}

function createLoadOptionsMock(credentialOverrides: Record<string, unknown> = {}) {
    const creds = { ...defaultCredentials, ...credentialOverrides };
    return {
        getNodeParameter: jest.fn(),
        getCredentials: jest.fn().mockResolvedValue(creds),
        helpers: { httpRequest: jest.fn() },
    } as unknown as ILoadOptionsFunctions;
}

// --- Tests ---

describe('LmStudioSimpleMessage', () => {
    let node: LmStudioSimpleMessage;

    beforeEach(() => {
        node = new LmStudioSimpleMessage();
    });

    describe('execute', () => {
        it('returns text response with metadata', async () => {
            const mock = createExecuteMock();
            (mock.helpers.httpRequest as jest.Mock).mockResolvedValue(chatResponse('Hello world'));

            const result = await node.execute.call(mock);

            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json.response).toBe('Hello world');
            expect(result[0][0].json._metadata).toMatchObject({
                model: 'test-model',
                finish_reason: 'stop',
            });
            expect(result[0][0].pairedItem).toEqual({ item: 0 });
        });

        it('parses JSON response when schema is provided', async () => {
            const schema = JSON.stringify({
                type: 'object',
                properties: { name: { type: 'string' } },
            });
            const mock = createExecuteMock({ jsonSchema: schema });
            (mock.helpers.httpRequest as jest.Mock).mockResolvedValue(
                chatResponse('{"name":"Alice"}'),
            );

            const result = await node.execute.call(mock);

            expect(result[0][0].json.response).toEqual({ name: 'Alice' });
        });

        it('throws NodeOperationError on invalid JSON schema string', async () => {
            const mock = createExecuteMock({ jsonSchema: '{not json' });

            await expect(node.execute.call(mock)).rejects.toThrow(NodeOperationError);
        });

        it('throws timeout error when request times out', async () => {
            const mock = createExecuteMock({ timeout: 30 });
            const err = new Error('timeout') as Error & { cause: { code: string } };
            err.cause = { code: 'ETIMEDOUT' };
            (mock.helpers.httpRequest as jest.Mock).mockRejectedValue(err);

            await expect(node.execute.call(mock)).rejects.toThrow(/timed out after 30 seconds/);
        });

        it('throws NodeApiError on generic HTTP failure', async () => {
            const mock = createExecuteMock();
            (mock.helpers.httpRequest as jest.Mock).mockRejectedValue(
                new Error('Connection refused'),
            );

            await expect(node.execute.call(mock)).rejects.toThrow(NodeApiError);
        });

        it('returns error item when continueOnFail is true', async () => {
            const mock = createExecuteMock();
            (mock.continueOnFail as jest.Mock).mockReturnValue(true);
            (mock.helpers.httpRequest as jest.Mock).mockRejectedValue(new Error('Server down'));

            const result = await node.execute.call(mock);

            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json.error).toContain('Server down');
            expect(result[0][0].pairedItem).toEqual({ item: 0 });
        });

        it('sends Authorization header when apiKey is set', async () => {
            const mock = createExecuteMock({}, { apiKey: 'sk-test-123' });
            (mock.helpers.httpRequest as jest.Mock).mockResolvedValue(chatResponse('ok'));

            await node.execute.call(mock);

            expect(mock.helpers.httpRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: 'Bearer sk-test-123' }),
                }),
            );
        });
    });

    describe('getModels', () => {
        it('returns sorted model list and marks loaded models', async () => {
            const mock = createLoadOptionsMock();
            (mock.helpers.httpRequest as jest.Mock).mockResolvedValue({
                data: [
                    { id: 'zephyr-7b', type: 'llm', state: 'not-loaded', quantization: 'Q4_K_M' },
                    { id: 'llama-3', type: 'llm', state: 'loaded' },
                    { id: 'whisper-v3', type: 'asr' }, // should be filtered out
                    { id: 'gemma-2', type: 'vlm', state: 'not-loaded' },
                ],
            });

            const result = await node.methods.loadOptions.getModels.call(mock);

            expect(result).toHaveLength(3);
            expect(result[0].name).toBe('gemma-2');
            expect(result[1].name).toBe('llama-3 (loaded)');
            expect(result[1].value).toBe('llama-3');
            expect(result[2].name).toBe('zephyr-7b');
            expect(result[2].description).toBe('Quantization: Q4_K_M');
        });
    });
});

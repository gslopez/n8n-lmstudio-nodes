import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

// --- Type definitions for LM Studio API responses ---

interface LmStudioModel {
	id: string;
	type?: string;
	state?: string;
	quantization?: string;
}

interface LmStudioModelsResponse {
	data: LmStudioModel[];
}

interface LmStudioChatChoice {
	message: { content: string };
	finish_reason: string;
}

interface LmStudioChatResponse {
	choices: LmStudioChatChoice[];
	model: string;
	usage: Record<string, unknown>;
	created: number;
	id: string;
}

// --- Utilities ---

function buildUrl(hostUrl: string, path: string): string {
	let base = hostUrl;
	if (!base.startsWith('http://') && !base.startsWith('https://')) {
		base = `http://${base}`;
	}
	// Remove trailing slash from base to avoid double slashes
	return `${base.replace(/\/+$/, '')}${path}`;
}

const JSON_SCHEMA_SAMPLE = `
{
	"type": "object",
	"properties": {
		"colors": {
			"type": "array",
			"items": { "type": "string" }
		}
	}
}
`;

export class LmStudioSimpleMessage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LM Studio Simple Message',
		name: 'lmStudioSimpleMessage',
		icon: { light: 'file:lmstudio.svg', dark: 'file:lmstudio.dark.svg' },
		group: ['output'],
		version: 1,
		description: 'Send messages to LM Studio with optional JSON schema for structured outputs',
		defaults: {
			name: 'LM Studio Simple Message',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'lmStudioApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Model Name or ID',
				name: 'modelName',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getModels',
				},
				default: '',
				required: true,
				noDataExpression: true,
				description: 'The model identifier to use. Models are fetched from your LM Studio server. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: {
					rows: 3,
				},
				default: '',
				required: true,
				description: 'The user message to send to the model',
			},
			{
				displayName: 'JSON Schema',
				name: 'jsonSchema',
				type: 'json',
				typeOptions: {
					rows: 10,
				},
				default: null,
				placeholder: JSON_SCHEMA_SAMPLE,
				description:
					'Optional JSON schema for structured output. Use {} for no schema. Example:' +
					JSON_SCHEMA_SAMPLE,
			},
			{
				displayName: 'Temperature',
				name: 'temperature',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 2,
					numberPrecision: 2,
				},
				default: 0.3,
				description:
					'Controls randomness. Lower values make output more focused and deterministic.',
			},
			{
				displayName: 'Max Tokens',
				name: 'maxTokens',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: null,
				description: 'Maximum number of tokens to generate. Leave empty for model default.',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				typeOptions: {
					minValue: 0,
				},
				default: 0,
				description:
					'Request timeout in seconds. Set to 0 for no timeout (default). LLM requests can take a while, especially with larger models.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('lmStudioApi');
				const hostUrl = credentials.hostUrl as string;
				const url = buildUrl(hostUrl, '/api/v0/models');

				try {
					const response = (await this.helpers.httpRequest({
						method: 'GET',
						url,
						json: true,
					})) as LmStudioModelsResponse;

					if (response?.data && Array.isArray(response.data)) {
						const models = response.data
							.filter((model) => model.type === 'llm' || model.type === 'vlm')
							.map((model) => ({
								name: `${model.id}${model.state === 'loaded' ? ' (loaded)' : ''}`,
								value: model.id,
								description: model.quantization
									? `Quantization: ${model.quantization}`
									: undefined,
							}))
							.sort((a: INodePropertyOptions, b: INodePropertyOptions) =>
								a.name.localeCompare(b.name),
							);

						if (models.length === 0) {
							return [{ name: 'No Models Found', value: '' }];
						}
						return models;
					}

					return [{ name: 'No Models Found', value: '' }];
				} catch {
					return [{ name: 'Could Not Connect to LM Studio', value: '' }];
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const logger = this.logger;
		const executionId = this.getExecutionId?.() ?? 'unknown';

		const credentials = await this.getCredentials('lmStudioApi');
		const hostUrl = credentials.hostUrl as string;
		const apiKey = credentials.apiKey as string;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Extract parameters
				const modelName = this.getNodeParameter('modelName', itemIndex) as string;
				const message = this.getNodeParameter('message', itemIndex) as string;
				const temperature = this.getNodeParameter('temperature', itemIndex) as number;
				const maxTokens = this.getNodeParameter('maxTokens', itemIndex, '') as
					| number
					| string;
				const timeout = this.getNodeParameter('timeout', itemIndex, 0) as number;
				const jsonSchemaStr = this.getNodeParameter('jsonSchema', itemIndex, '{}') as string;

				logger.info(`[${executionId}] Starting LM Studio request`, {
					itemIndex,
					model: modelName,
					messageLength: message.length,
					timeout: timeout || 'none',
				});

				// Build base request body
				const requestBody: {
					model: string;
					messages: Array<{ role: string; content: string }>;
					temperature: number;
					max_tokens?: number;
					response_format?: {
						type: string;
						json_schema: unknown;
					};
				} = {
					model: modelName,
					messages: [{ role: 'user', content: message }],
					temperature,
				};

				// Add max_tokens if provided
				if (maxTokens && typeof maxTokens === 'number' && maxTokens > 0) {
					requestBody.max_tokens = maxTokens;
				}

				// Parse and add JSON schema if provided
				let hasJsonSchema = false;
				if (jsonSchemaStr && typeof jsonSchemaStr === 'string' && jsonSchemaStr.trim()) {
					try {
						const parsedSchema = JSON.parse(jsonSchemaStr || '{}') as Record<
							string,
							unknown
						>;
						if (Object.keys(parsedSchema).length > 0) {
							requestBody.response_format = {
								type: 'json_schema',
								json_schema: {
									name: 'outputSchema',
									strict: true,
									schema: parsedSchema,
								},
							};
							hasJsonSchema = true;
						}
					} catch (parseError) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid JSON Schema: ${(parseError as Error).message}`,
							{ itemIndex },
						);
					}
				}

				const url = buildUrl(hostUrl, '/v1/chat/completions');
				const abortSignal = this.getExecutionCancelSignal?.();

				// Build request headers
				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
				};
				if (apiKey) {
					headers['Authorization'] = `Bearer ${apiKey}`;
				}

				const startTime = Date.now();
				let response: LmStudioChatResponse;
				try {
					response = (await this.helpers.httpRequest({
						method: 'POST',
						url,
						headers,
						body: requestBody,
						json: true,
						timeout: timeout > 0 ? timeout * 1000 : undefined,
						abortSignal,
					})) as LmStudioChatResponse;
				} catch (error) {
					const err = error as NodeApiError & {
						code?: string;
						cause?: { code?: string };
					};
					const errorCode = err.code ?? err.cause?.code;
					const isTimeout =
						errorCode === 'ETIMEDOUT' ||
						errorCode === 'ESOCKETTIMEDOUT' ||
						errorCode === 'ECONNABORTED';

					logger.error(`[${executionId}] LM Studio request failed`, {
						itemIndex,
						model: modelName,
						errorCode,
						errorMessage: err.message,
						isTimeout,
					});

					if (isTimeout) {
						throw new NodeOperationError(
							this.getNode(),
							`Request timed out after ${timeout} seconds. Consider increasing the timeout for larger models.`,
							{ itemIndex },
						);
					}

					throw new NodeApiError(this.getNode(), error as JsonObject, {
						itemIndex,
						message: `LM Studio request failed: ${err.message}`,
					});
				}

				const duration = Date.now() - startTime;
				logger.info(`[${executionId}] LM Studio request completed`, {
					itemIndex,
					durationMs: duration,
					model: modelName,
				});

				// Validate response structure
				if (!response.choices?.[0]?.message) {
					throw new NodeOperationError(
						this.getNode(),
						'Invalid response structure from LM Studio',
						{ itemIndex },
					);
				}

				const content = response.choices[0].message.content;
				if (!content) {
					throw new NodeOperationError(
						this.getNode(),
						'No content in response from LM Studio',
						{ itemIndex },
					);
				}

				// Build metadata from LM Studio response
				const metadata = {
					model: response.model,
					usage: response.usage,
					created: response.created,
					id: response.id,
					finish_reason: response.choices[0].finish_reason,
				};

				// Parse JSON if schema was provided, otherwise return direct text
				let responseData: IDataObject;
				if (hasJsonSchema) {
					try {
						const parsedContent = JSON.parse(content) as IDataObject;
						responseData = {
							response: parsedContent,
							_metadata: metadata,
						};
					} catch (parseError) {
						throw new NodeOperationError(
							this.getNode(),
							`Failed to parse response as JSON: ${(parseError as Error).message}. Content: ${content}`,
							{ itemIndex },
						);
					}
				} else {
					responseData = {
						response: content,
						_metadata: metadata,
					};
				}

				returnData.push({
					json: responseData,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					throw error;
				}
				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex,
				});
			}
		}

		return [returnData];
	}
}

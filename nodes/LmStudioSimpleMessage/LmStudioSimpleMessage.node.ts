import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import axios from 'axios';
import * as http from 'http';
import * as https from 'https';

// Keep-alive agents for maintaining persistent connections during long LLM inference
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });


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
		group: ['transform'],
		version: 1,
		description: 'Send messages to LM Studio with optional JSON schema for structured outputs',
		defaults: {
			name: 'LM Studio Simple Message',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Host Name',
				name: 'hostName',
				type: 'string',
				default: 'https://localhost:1234',
				required: true,
				placeholder: 'https://localhost:1234',
				description: 'LM Studio server hostname and port',
			},
			{
				displayName: 'Model Name',
				name: 'modelName',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getModels',
					loadOptionsDependsOn: ['hostName'],
				},
				default: '',
				required: true,
				noDataExpression: true,
				description: 'The model identifier to use. Models are fetched from your LM Studio server.',
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
				description: 'Optional JSON schema for structured output. Use {} for no schema. Example:' + JSON_SCHEMA_SAMPLE,
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
				description: 'Controls randomness. Lower values make output more focused and deterministic.',
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
				description: 'Request timeout in seconds. Set to 0 for no timeout (default). LLM requests can take a while, especially with larger models.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const hostName = this.getNodeParameter('hostName', '') as string;

				let url = hostName;
				if (!hostName.startsWith('http://') && !hostName.startsWith('https://')) {
					url = `http://${hostName}`;
				}
				url = `${url}/api/v0/models`;

				try {
					const response = await this.helpers.httpRequest({
						method: 'GET',
						url,
						json: true,
					});

					if (response?.data && Array.isArray(response.data)) {
						const models = response.data
							.filter((model: { type?: string }) => model.type === 'llm' || model.type === 'vlm')
							.map((model: { id: string; state?: string; quantization?: string }) => ({
								name: `${model.id}${model.state === 'loaded' ? ' (loaded)' : ''}`,
								value: model.id,
								description: model.quantization ? `Quantization: ${model.quantization}` : undefined,
							}))
							.sort((a: INodePropertyOptions, b: INodePropertyOptions) => a.name.localeCompare(b.name));

						if (models.length === 0) {
							return [{ name: 'No models found', value: '' }];
						}
						return models;
					}

					return [{ name: 'No models found', value: '' }];
				} catch {
					return [{ name: 'Could not connect to LM Studio', value: '' }];
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const logger = this.logger;
		const executionId = this.getExecutionId?.() ?? 'unknown';

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Extract parameters
				const hostName = this.getNodeParameter('hostName', itemIndex) as string;
				const modelName = this.getNodeParameter('modelName', itemIndex) as string;
				const message = this.getNodeParameter('message', itemIndex) as string;
				const temperature = this.getNodeParameter('temperature', itemIndex) as number;
				const maxTokens = this.getNodeParameter('maxTokens', itemIndex, '') as number | string;
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
					messages: [
						{
							role: 'user',
							content: message,
						},
					],
					temperature: temperature,
				};

				// Add max_tokens if provided
				if (maxTokens && typeof maxTokens === 'number' && maxTokens > 0) {
					requestBody.max_tokens = maxTokens;
				}

				// Parse and add JSON schema if provided
				let hasJsonSchema = false;
				if (jsonSchemaStr && typeof jsonSchemaStr === 'string' && jsonSchemaStr.trim()) {
					try {
						const parsedSchema = JSON.parse(jsonSchemaStr || '{}');
						if (Object.keys(parsedSchema).length > 0) {
							requestBody.response_format = {
								type: 'json_schema',
								json_schema: {
									name: "outputSchema",
									strict: true,
									schema: parsedSchema,
								},
							};
							hasJsonSchema = true;
						}
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid JSON Schema: ${error.message}`,
							{ itemIndex },
						);
					}
				}

				// Auto-detect protocol
				let url = hostName;
				if (!hostName.startsWith('http://') && !hostName.startsWith('https://')) {
					url = `http://${hostName}`;
				}
				url = `${url}/v1/chat/completions`;

				// Make HTTP request with abort signal support and keep-alive
				let response;
				try {
					const abortSignal = this.getExecutionCancelSignal?.();

					const startTime = Date.now();
					const axiosResponse = await axios({
						method: 'POST',
						url,
						headers: {
							'Content-Type': 'application/json',
						},
						data: requestBody,
						httpAgent,
						httpsAgent,
						timeout: timeout > 0 ? timeout * 1000 : 0,
						signal: abortSignal,
					});
					response = axiosResponse.data;
					const duration = Date.now() - startTime;

					logger.info(`[${executionId}] LM Studio request completed`, {
						itemIndex,
						durationMs: duration,
						model: modelName,
					});
				} catch (error) {
					const isAborted = error.name === 'AbortError' || error.code === 'ABORT_ERR';
					const isTimeout = error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT' || error.message?.includes('timeout');

					logger.error(`[${executionId}] LM Studio request failed`, {
						itemIndex,
						model: modelName,
						errorName: error.name,
						errorCode: error.code,
						errorMessage: error.message,
						isAborted,
						isTimeout,
					});

					if (isAborted) {
						throw new NodeOperationError(
							this.getNode(),
							'Request was cancelled (execution aborted or timed out)',
							{ itemIndex },
						);
					}

					const details = error.response?.data
						? `\n${JSON.stringify(error.response.data, null, 2)}`
						: '';
					throw new NodeOperationError(
						this.getNode(),
						`LM Studio request failed: ${error.message}${details}`,
						{ itemIndex },
					);
				}

				// Validate and extract response content
				if (!response.choices || !response.choices[0] || !response.choices[0].message) {
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

				// Parse JSON if schema was provided, otherwise return direct text
				if (hasJsonSchema) {
					try {
						const parsedContent = JSON.parse(content);
						items[itemIndex].json = parsedContent;
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`Failed to parse response as JSON: ${error.message}. Content: ${content}`,
							{ itemIndex },
						);
					}
				} else {
					items[itemIndex].json = { response: content };
				}
			} catch (error) {
				// Handle errors according to continueOnFail setting
				if (this.continueOnFail()) {
					items.push({
						json: items[itemIndex].json,
						error,
						pairedItem: itemIndex,
					});
				} else {
					// If the error already has context with itemIndex, throw it as-is
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, {
						itemIndex,
					});
				}
			}
		}

		return [items];
	}
}

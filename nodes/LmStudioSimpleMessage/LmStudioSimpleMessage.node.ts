import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

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
				default: 'localhost:1234',
				required: true,
				placeholder: 'localhost:1234 or https://api.example.com',
				description: 'LM Studio server hostname and port. Include https:// for secure connections.',
			},
			{
				displayName: 'Model Name',
				name: 'modelName',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'local-model',
				description: 'The model identifier to use',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: {
					rows: 5,
				},
				default: '',
				required: true,
				description: 'The user message to send to the model',
			},
			{
				displayName: 'JSON Schema',
				name: 'jsonSchema',
				type: 'json',
				default: '',
				description: 'Optional JSON schema for structured output. Provide any valid JSON schema - it will be automatically wrapped in the required format.',
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
				default: 1.0,
				description: 'Controls randomness. Lower values make output more focused and deterministic.',
			},
			{
				displayName: 'Max Tokens',
				name: 'maxTokens',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: '',
				description: 'Maximum number of tokens to generate. Leave empty for model default.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Extract parameters
				const hostName = this.getNodeParameter('hostName', itemIndex) as string;
				const modelName = this.getNodeParameter('modelName', itemIndex) as string;
				const message = this.getNodeParameter('message', itemIndex) as string;
				const temperature = this.getNodeParameter('temperature', itemIndex) as number;
				const maxTokens = this.getNodeParameter('maxTokens', itemIndex, '') as number | string;
				const jsonSchemaStr = this.getNodeParameter('jsonSchema', itemIndex, '') as string;

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
						const parsedSchema = JSON.parse(jsonSchemaStr);
						requestBody.response_format = {
							type: 'json_schema',
							json_schema: parsedSchema,
						};
						hasJsonSchema = true;
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

				// Make HTTP request
				let response;
				try {
					response = await this.helpers.httpRequest({
						method: 'POST',
						url,
						headers: {
							'Content-Type': 'application/json',
						},
						body: requestBody,
						json: true,
					});
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`HTTP request failed: ${error.message}`,
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
					items[itemIndex].json = content;
				}
			} catch (error) {
				// Handle errors according to continueOnFail setting
				if (this.continueOnFail()) {
					items.push({
						json: this.getInputData(itemIndex)[0].json,
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

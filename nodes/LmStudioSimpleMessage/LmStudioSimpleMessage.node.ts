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

		// TODO: Implement execution logic

		return [items];
	}
}

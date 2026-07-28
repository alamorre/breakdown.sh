export interface ProtocolValidationError {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

export interface ProtocolValidator {
  (value: unknown): boolean;
  errors?: ProtocolValidationError[] | null;
}

export const validateOperationRequest: ProtocolValidator;
export const validateValidateWorkflowRequest: ProtocolValidator;
export const validateCreateRunRequest: ProtocolValidator;
export const validateInspectRunRequest: ProtocolValidator;
export const validatePrepareWorkRequest: ProtocolValidator;
export const validateReadWorkInputRequest: ProtocolValidator;
export const validateSubmitCandidateRequest: ProtocolValidator;

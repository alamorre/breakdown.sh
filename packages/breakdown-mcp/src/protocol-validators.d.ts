export interface ProtocolValidator {
  (value: unknown): boolean;
}

export const validateValidateWorkflowArguments: ProtocolValidator;
export const validateCreateRunArguments: ProtocolValidator;
export const validateInspectRunArguments: ProtocolValidator;
export const validatePrepareWorkArguments: ProtocolValidator;
export const validateReadWorkInputArguments: ProtocolValidator;
export const validateSubmitCandidateArguments: ProtocolValidator;

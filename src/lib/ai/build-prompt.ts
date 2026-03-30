export interface UpstreamInput {
  nodeName: string;
  nodeOutput: string;
  edgeType: string;
}

export function buildRunPrompt(nodePrompt: string, upstreamInputs: UpstreamInput[]): string {
  if (upstreamInputs.length === 0) {
    return nodePrompt;
  }

  const contextLines = upstreamInputs.map(
    (input) => `[${input.edgeType.toUpperCase()}] From "${input.nodeName}":\n${input.nodeOutput}`,
  );

  return `The following context has been provided from upstream nodes in a reasoning graph:\n\n${contextLines.join('\n\n---\n\n')}\n\n---\n\nYour task:\n${nodePrompt}`;
}

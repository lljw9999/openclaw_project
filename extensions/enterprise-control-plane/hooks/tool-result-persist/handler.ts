import { sanitizeToolOutput } from "../_lib/client";
import { assignStringField, extractStringField } from "../_lib/event-shape";

const handler = async (event: unknown): Promise<unknown> => {
  const output = extractStringField(event, ["output", "result", "text"], undefined, "tool_result_persist");
  if (output === null) {
    return event;
  }

  const sanitized = await sanitizeToolOutput(output);
  return assignStringField(event, ["output", "result", "text"], sanitized);
};

export default handler;

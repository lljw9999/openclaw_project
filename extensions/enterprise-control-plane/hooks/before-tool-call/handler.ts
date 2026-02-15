import { enforceToolCallPolicy } from "../_lib/client";
import { extractToolCall } from "../_lib/event-shape";

const handler = async (event: unknown): Promise<unknown> => {
  const toolCall = extractToolCall(event);
  if (!toolCall) {
    return event;
  }

  await enforceToolCallPolicy(toolCall);
  return event;
};

export default handler;

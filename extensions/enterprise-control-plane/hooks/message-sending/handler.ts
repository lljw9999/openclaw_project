import { validateOutboundMessage } from "../_lib/client";
import { assignStringField, extractStringField } from "../_lib/event-shape";

const handler = async (event: unknown): Promise<unknown> => {
  const message = extractStringField(event, ["message", "text", "content"], undefined, "message_sending");
  if (message === null) {
    return event;
  }

  const sanitized = await validateOutboundMessage(message);
  return assignStringField(event, ["message", "text", "content"], sanitized);
};

export default handler;

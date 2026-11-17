import { z } from 'zod';

/**
 * Dify Service API streaming events (chat and agent apps). Objects are loose: Dify adds
 * fields between versions and we only depend on the ones listed here.
 */
const base = {
  task_id: z.string(),
  message_id: z.string(),
  conversation_id: z.string(),
};

export const difyRetrieverResourceSchema = z.looseObject({
  position: z.number().int(),
  document_id: z.string().nullish(),
  document_name: z.string().nullish(),
  dataset_name: z.string().nullish(),
  content: z.string().nullish(),
});

export const difyStreamEventSchema = z.discriminatedUnion('event', [
  z.looseObject({ event: z.literal('message'), ...base, answer: z.string() }),
  z.looseObject({ event: z.literal('agent_message'), ...base, answer: z.string() }),
  z.looseObject({ event: z.literal('agent_thought'), ...base }),
  z.looseObject({ event: z.literal('message_replace'), ...base, answer: z.string() }),
  z.looseObject({
    event: z.literal('message_end'),
    ...base,
    metadata: z
      .looseObject({ retriever_resources: z.array(difyRetrieverResourceSchema).nullish() })
      .nullish(),
  }),
  z.looseObject({
    event: z.literal('error'),
    task_id: z.string().nullish(),
    message_id: z.string().nullish(),
    status: z.number().int().nullish(),
    code: z.string().nullish(),
    message: z.string().nullish(),
  }),
  z.looseObject({ event: z.literal('ping') }),
]);

export type DifyStreamEvent = z.infer<typeof difyStreamEventSchema>;

/** JSON body of a non-2xx Dify response. */
export const difyErrorBodySchema = z.looseObject({
  code: z.string().optional(),
  message: z.string().optional(),
  status: z.number().optional(),
});

/** `GET /parameters` (only the fields the gateway uses). */
export const difyParametersSchema = z.looseObject({
  opening_statement: z.string().nullish(),
  suggested_questions: z.array(z.string()).nullish(),
});
export type DifyParameters = z.infer<typeof difyParametersSchema>;

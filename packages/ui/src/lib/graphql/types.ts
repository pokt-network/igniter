import { TypedDocumentNode } from '@graphql-typed-document-node/core'

export type DocumentNodeData<T extends TypedDocumentNode<any, any>> = T extends TypedDocumentNode<infer Data, any> ? Data : never;

export type ExtractVariables<T> = T extends TypedDocumentNode<any, infer Variables> ? Variables : never;

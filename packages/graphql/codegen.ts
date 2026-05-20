import type { CodegenConfig } from '@graphql-codegen/cli'
import { config as dotenvConfig } from 'dotenv';
import * as path from 'node:path'

dotenvConfig({
  quiet: true,
  // to use the .env file from both the root .env and the package .env
  path: [path.join(__dirname, '..', '..', '.env'), '.env'],
});

let graphqlApiUrl = process.env.GRAPHQL_API_URL;
if (!graphqlApiUrl || graphqlApiUrl === "") {
  graphqlApiUrl = "https://data.pocket.network"
}

console.log(`Generating GraphQL types from schema at: ${graphqlApiUrl}`)

const config: CodegenConfig = {
  schema: graphqlApiUrl,
  documents: ['src/**/*.ts'],
  generates: {
    './src/gql/': {
      preset: 'client',
      config: {
        namingConvention: {
          enumValues: 'keep'
        }
      }
    },
    './schema.graphql': {
      plugins: ['schema-ast'],
      config: {
        includeDirectives: false
      }
    }
  }
}
export default config

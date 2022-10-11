import { ApolloServer, gql } from 'apollo-server-lambda';
import { ApolloServerPluginLandingPageGraphQLPlayground } from 'apollo-server-core';

const typeDefs = gql`
  type Query {
    hello: String
  }

  scalar DateTime

  type Transaction {
    accountNumber: String!
    timestamp: DateTime!
    amount: Float!
    description: String!
  }

  type Mutation {
    logTransaction(accountNumber: String!, amount: Float!, description: String!): Transaction!
  }
`;

const resolvers = {
  Query: {
    hello: () => 'Hello world!',
  },
  Mutation: {
    logTransaction: (_source: unknown, args: any) => {
        const {accountNumber, amount, description} = args;
        const tx = {
            timestamp: 'TODO',
            accountNumber,
            amount,
            description
        };

        return tx;
    }
  }
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  plugins: [ApolloServerPluginLandingPageGraphQLPlayground()],
});

export const handler = server.createHandler();
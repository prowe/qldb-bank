import { ApolloServer, gql } from 'apollo-server-lambda';
import { ApolloServerPluginLandingPageGraphQLPlayground } from 'apollo-server-core';
import { QldbDriver } from "amazon-qldb-driver-nodejs";
import { Decimal, Timestamp } from 'ion-js';

const typeDefs = gql`
  type Account {
    accountNumber: String!
    transactions: [Transaction!]!
  }

  type Query {
    account(accountNumber: String!): Account!
  }

  scalar DateTime

  type Transaction {
    accountNumber: String!
    timestamp: DateTime!
    amount: Float!
    description: String!
  }

  type Transfer {
    debit: Transaction!
    credit: Transaction!
  }

  type Mutation {
    logTransaction(accountNumber: String!, amount: Float!, description: String!): Transaction!
    transfer(fromAccount: String!, toAccount: String!, amount: Float!, description: String!): Transfer!
  }
`;

function createDriver(): QldbDriver {
    const ledgerName = process.env['LEDGER_NAME'];
    if (!ledgerName) {
        throw new Error('LEDGER_NAME not set');
    }
    return new QldbDriver(ledgerName);
}

interface BankTransaction {
    timestamp: Timestamp;
    accountNumber: String;
    amount: Decimal;
    description: String;
}

function createTransaction(accountNumber: String, amount: number, description: String): BankTransaction {
    const now = new Date();
    return {
        // There is a bug in the Timestamp class with millisecons != 0
        timestamp: new Timestamp(
            now.getTimezoneOffset() * -1,
            now.getFullYear(),
            now.getMonth() + 1,
            now.getDate(),
            now.getHours(),
            now.getMinutes(),
            new Decimal(now.getSeconds() * 1000 + now.getMilliseconds(), -3)
        ),
        accountNumber,
        amount: new Decimal(amount * 100, -2),
        description
    };
}

const resolvers = {
  Query: {
    account(_source: unknown, {accountNumber}: {accountNumber: String}) {
        return {
            accountNumber
        }
    }
  },
  Account: {
    async transactions({accountNumber}: {accountNumber: String}) {
        const driver = createDriver();
        try {
            const result = await driver.executeLambda(dbTx => dbTx.execute('SELECT * FROM Transactions where accountNumber = ?', accountNumber));
            return result.getResultList().map((row): BankTransaction => {
                return {
                    timestamp: row.get('timestamp')!.timestampValue()!,
                    accountNumber: row.get('accountNumber')!.stringValue()!,
                    amount: row.get('amount')!.decimalValue()!,
                    description: row.get('description')!.stringValue()!,
                }
            });
        } finally {
            driver.close();
        }
    }
  },
  Mutation: {
    async logTransaction(_source: unknown, args: any) {
        const {accountNumber, amount, description} = args;
        const tx = createTransaction(accountNumber, amount, description);

        const driver = createDriver();
        try {
            await driver.executeLambda(dbTx => dbTx.execute('INSERT INTO Transactions ?', tx));
        } finally {
            driver.close();
        }

        return tx;
    },
    async transfer(_source: unknown, args: any) {
        const {fromAccount, toAccount, amount, description} = args;
        const debit = createTransaction(fromAccount, amount * -1, description);
        const credit = createTransaction(toAccount, amount, description);

        const driver = createDriver();
        try {
            await driver.executeLambda(dbTx => dbTx.execute('INSERT INTO Transactions ?', [debit, credit]));
        } finally {
            driver.close();
        }
        
        return {
            debit,
            credit
        };
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
## Let's Build a Bank

Over the weekend I was listending to a recent episode of Software Engineering Daily titled ["Twisp: Reinventing the Ledger"](https://softwareengineeringdaily.com/2022/10/07/twisp-reinventing-the-ledger/).
In that podcast they discuss the complexities of building an accounting ledger system, especially at scale.
Late in the podcast, the host asks what other software is out there in this space, and the [Quantam Ledger Database from AWS]() was mentioned.
Since I have never use it, I thought it might be fund to build a simple bank on this platform.

I am going to start by setting up an API.
I want to use GraphQL and run this serverless, so I am going to use the [Apollo Server Lambda](https://www.npmjs.com/package/apollo-server-lambda) NodeJS package.
I like using the [Serverless Application Model (SAM)](https://aws.amazon.com/serverless/sam/) to deploy Lambda functions becuase it handles packaging and uploading the code for me.
Beyond that, it is also capable of building code as well.
Googling around I found [This blog post](https://aws.amazon.com/blogs/compute/building-typescript-projects-with-aws-sam-cli/) that lays out how to let SAM build a typescript application. 
After following those instructions, I now have a directory with a `hello-world` API gateway endpoint.

I want to deploy that real quick to make sure I have a working stack.
First I like to create a `samconfig.toml` file to hold my stack name and other defaults so I don't have to specify them on the command line each time
```toml
version=0.1

[default.build.parameters]
beta_features = true

[default.sync.parameters]
beta_features = true

[default.global.parameters]
stack_name = "bank-app"
region = "us-east-1"

[default.deploy.parameters]
fail_on_empty_changeset = "false"
capabilities = "CAPABILITY_IAM"
resolve_s3 = true
```

Now I can build and deploy the app just to sanity check it
```bash
sam build && sam deploy
```

Once this completes, I am going to gut the project and swap out everything into what I actually want:
1. GraphQL only has one URL that is responsible for the entire API, so we don't need the `hello-world` directory. 
    Instead, I am going to pull all the contents out of it into the root directory.
    ```bash
    mv hello-world/* .
    ```
1. I'm not sure what the testing strategy is going to be for this app yet, but I will probably use Vitest over Jest. 
    So I am going to delete all the testing related artifacts.
    ```bash
    rm -rf unit jest.config.ts
    ```
1. Since we moved the function up a level, we need to modify the template to remove the `CodeUri` property so that it defaults to the root of the project.
1. Lastly, rebuild and deploy the app and make sure it still works:
    ```bash
    sam build && sam deploy
    ```

Now, I am going to head over to the [apollo-server-lambda page](https://www.npmjs.com/package/apollo-server-lambda) and bend our app to fit its instructions.
1. Need to install the library
    ```bash
    npm install --save apollo-server-lambda graphql
    ```
1. It wants us to create a `graphql.js` file as the main handler.
    Instead, I'm going to create a file at `src/graphql.ts` since I am using typescript.
    I can then populate it with the typescript equivilent of the example code:
    ```typescript
    import { ApolloServer, gql } from 'apollo-server-lambda';
    import { ApolloServerPluginLandingPageGraphQLPlayground } from 'apollo-server-core';

    const typeDefs = gql`
        type Query {
            hello: String
        }
    `;

    const resolvers = {
        Query: {
            hello: () => 'Hello world!',
        },
    };

    const server = new ApolloServer({
        typeDefs,
        resolvers,
        introspection: true,
        plugins: [ApolloServerPluginLandingPageGraphQLPlayground()],
    });

    export const handler = server.createHandler();
    ```
1. Don't need the `app.ts` anymore, so I can delete that
1. Need to update our `template.yaml` file so that the lambda function matches the path of our new file
    ```yaml
    Handler: src/graphql.handler
    Events:
        AnyRequest:
            Type: Api
            Properties:
                Path: /graphql
                Method: ANY
    ```
    Remember to leave the `Metadata` section so that SAM knows how to build our function. 
    Just update the entrypoint.
1. I renamed `HelloWorldFunction` to `GraphqlFunction` in the template and removed some extra outputs.
1. Now, if everything lines up, it should build and deploy and give us a simple GraphQL api.
    ```bash
    sam build && sam deploy
    ```

Awesome!
With that working the API can be expanded a bit.
I am going to add a `DateTime` scalar and `Transaction` type to the typedefs:
```graphql
scalar DateTime

type Transaction {
    accountNumber: String!
    timestamp: DateTime!
    amount: Float!
    description: String!
}
```

Next, I will create a mutation to create a transaction:
```graphql
type Mutation {
    logTransaction(accountNumber: String!, amount: Float!, description: String!): Transaction!
}
```

We can add a mutation section to our resolvers to handle the call:
```typescript
Mutation: {
  logTransaction: async (_source: unknown, args: any) => {
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
```

This isn't very useful yet.
What is needed is a place to store these transactions. 
Enter the [Quantam Ledger Database Service (QLDB)](https://docs.aws.amazon.com/qldb/latest/developerguide/).
This service is rooted in a resource called a `Ledger`.
This is similar to a database or schema in a relational system.
It is a container for `Tables` and those contain records.
We can create a ledger by adding a resource to our Cloudformation `template.yaml`:
```yaml
Ledger:
  Type: "AWS::QLDB::Ledger"
  Properties:
    DeletionProtection: false
    PermissionsMode: "STANDARD"
```

I am going to inject the name of the Ledger into our function:
```yaml
Environment:
  Variables:
    LEDGER_NAME: !Ref Ledger
```

With that complete, we need to create a `Table` within our ledger to hold transactions.
This is kinda annoying since there is no built in support for that within Cloudformation and there is also no built in migration framework.
A couple strategies come to mind to resolve this:
1. We could just manually do it via some one-off script. This is pretty high-touch and risky as we add indexes and other tables
1. We could use some sort of "migration framework" like Flyway to run the SQL to manage the schema. This is awkward because QLDB isn't a relational database with a JDBC driver that can be dropped in.
1. A Cloudformation custom resource is a possible solution, they are a pain to setup though and hard to troubleshoot when they don't work.
1. Maybe create a Cloudformation extension. This is also pretty heavyweight.

To keep this project moving forward, I am going to punt on this problem and just manually run these queries via the console. 
I'll log into to the AWS console and run the following queries:
```sql
CREATE TABLE Transactions;
CREATE INDEX ON Transactions (accountNumber);
```

Next, we need to create a connection to the Ledger from our Lambda.
It would have been nice for the AWS SDK to support this but instead we have to download a QLDB specific library.
Following the instructions on [this NodeJS example documentation](https://docs.aws.amazon.com/qldb/latest/developerguide/driver-quickstart-nodejs.html#driver-quickstart-nodejs.step-1) I installed the following libraries:
```bash
npm install --save amazon-qldb-driver-nodejs @aws-sdk/client-qldb-session @aws-sdk/client-qldb ion-js jsbi
```

I'll create a factory function to get a connection to the Ledger:
```Typescript
import { QldbDriver } from "amazon-qldb-driver-nodejs";
//...
function createDriver(): QldbDriver {
    const ledgerName = process.env['LEDGER_NAME'];
    if (!ledgerName) {
        throw new Error('LEDGER_NAME not set');
    }
    return new QldbDriver(ledgerName);
}
```

Since the default permissions for the Lambda function are very restrictive, we need to grant it the ability to mange the `Transaction` table.
It is pretty easy to set this up with SAM by adding a `Polcies` key to our function:
```yaml
Policies:
  - Version: '2012-10-17' 
    Statement:
      - Effect: Allow
        Action:
          - "qldb:SendCommand"
        Resource: !Sub "arn:aws:qldb:${AWS::Region}:${AWS::AccountId}:ledger/${Ledger}"
      - Effect: Allow
        Action:
          - "qldb:PartiQLDelete"
          - "qldb:PartiQLInsert"
          - "qldb:PartiQLUpdate"
          - "qldb:PartiQLSelect"
          - "qldb:PartiQLHistoryFunction"
        Resource:
          - !Sub "arn:aws:qldb:${AWS::Region}:${AWS::AccountId}:ledger/${Ledger}/table/*"
          - !Sub "arn:aws:qldb:${AWS::Region}:${AWS::AccountId}:ledger/${Ledger}/information_schema/user_tables"
```

With the access granted and the Ledger and table created, I can add some code to our GraphQL resolver to insert a row into the table:
```Typescript
async logTransaction(_source: unknown, args: any) {
  const {accountNumber, amount, description} = args;
  const now = new Date();
  const tx: BankTransaction = {
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

  const driver = createDriver();
  try {
    await driver.executeLambda(dbTx => dbTx.execute('INSERT INTO Transactions ?', tx));
  } finally {
    driver.close();
  }

  return tx;
}
```

If we open up the endpoint in our browser, we should be able to submit a GraphQL request like the below and get some results back:
```GraphQL
mutation {
  logTransaction(accountNumber: "0001", amount: 45.0, description: "Inital Balance") {
    accountNumber
    timestamp
    amount
    description
  }
}
```

We can then pull up the QLDB console and confirm this transaction exists by running this query:
```sql
select *
from Transactions;
```

It would be nice to be able to pull up these transactions via the API.
We can support this by adding an Account type and corrisponding declarations to our GraphQL schema:
```GraphQL
type Account {
  accountNumber: String!
  transactions: [Transaction!]!
}

type Query {
  account(accountNumber: String!): Account!
}
```

The resolvers will return an empty shell for the `Account` and implement a query to get all the `Transaction` records:
```Typescript
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
```

Having to do that conversion from the Ion types to native JS types is pretty annoying.


Finally, let's implement one last feature.
We can utilize the transactions in QLDB to support transfer between accounts.
Start with the GraphQL:
```GraphQL:
type Transfer {
  debit: Transaction!
  credit: Transaction!
}

type Mutation {
  #...
  transfer(fromAccount: String!, toAccount: String!, amount: Float!, description: String!): Transfer!
}
```

I'm going to pull out the creation of a `BankTransaction` into a helper function since the timestamp issue makes it a pain to construct:
```Typescript
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
```

Since the `executeLambda` function supports taking a list for multiple inserts, we can send through a list of transactions to put them in all at once:
```Typescript
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
```

Awesome! Time to give some money to an account:
```GraphQL
mutation {
  transfer(fromAccount: "0001", toAccount: "0002", amount: 20, description: "Happy Birthday") {
    debit {
      amount
    }
    credit {
      amount
    }
  }
}
```


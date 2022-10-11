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

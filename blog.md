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


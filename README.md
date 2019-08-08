# serverless-shared-gateway
Serverless shared gateway, was developed originally by [kalarrs](https://github.com/kalarrs/serverless-shared-api-gateway), but I saw that it was a little bit abandoned. So I fix a few bugs that the plugin had, and add some extra functionality. Currently I am working on a Enterprise plugin for the Serverless Framework, so I will be updating this package regularly. 

Note: I know that the code inside of the index.js is a little bit messy, but it works and I am working on a cleaner version that is backward compatible. 

Add in your "custom" property the following tag:
```yaml
custom: 
  sharedGateway:  
    # This should be your gateway name 
    gatewayName: api-gateway-name
    # will create a file once the api-gateway is recognized by serverless-framework 
    outputResources: true 
    # This is the file name, usually you want to set it as a .env  (default is .output)
    outputFilename: hello_world 
    # This option will remove the "create api gateway functionality, and will spit out the resourceId insted of overighting the gateway
    domainManagerCompatible: true
```
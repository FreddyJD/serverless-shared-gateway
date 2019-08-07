# serverless-shared-gateway
Lets make your life easier with share gateway inside serverless 

This plugin was origially developed by [kalarrs](https://github.com/kalarrs/serverless-shared-api-gateway), but with some modifications. 

Add in your "custom" property the following tag:
```yaml
custom: 
  sharedGateway: 
    gatewayName: your-cool-api-gateway-name
    outputResources: true # Optional 
    outputFilename: hello_world # Optional 
```
the outputResources will generate a ``` .output ``` file, with the resource name and resource id. 


### To-do
- Make the rootResourceId and apiGatewayId enviormental variable
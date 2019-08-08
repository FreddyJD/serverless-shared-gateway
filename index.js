'use strict';
const fs = require('fs')
const {
  promisify
} = require('util')
const writeFile = promisify(fs.writeFile)

class sls_shared_api_gateway {
  constructor(serverless, options) {
    // Serverless options. 

    this.serverless = serverless
    this.options = options

    // initialized variables. 
    this.initialized = false
    this.restApiId = null
    this.restApiName = null
    this.restApiResourceId = null
    this.resources = null
    this.outputResources = false
    this.outputFilename = null
    this.domainManagerCompatible = false

    this.commands = {
      shared_api_gateway: {
        validate: {
          usage: 'Checks to see if the AWS API gateway exists and if you have permission',
          lifecycleEvents: [
            'validate'
          ]
        },
        create: {
          usage: 'Creates an AWS API gateway',
          lifecycleEvents: [
            'initialize',
            'create'
          ]
        },
        delete: {
          usage: 'Deletes an AWS API gateway',
          lifecycleEvents: [
            'initialize',
            'delete'
          ]
        }
      }
    }

    this.hooks = {
      'shared_api_gateway:delete:delete': this.deleteRestApi.bind(this),
      'shared_api_gateway:create:create': this.createRestApi.bind(this),
      'after:package:compileEvents': this.compileEvents.bind(this),
      'after:info:info': this.summary.bind(this),
    }
  }

  initialSetup() {
    if (!this.initialized) {
      const awsCreds = this.serverless.providers.aws.getCredentials()
      this.apiGateway = new this.serverless.providers.aws.sdk.APIGateway(awsCreds)
      this.initialized = true
    }
  }

  createRestApi() {
    this.initialSetup();
    if (this.domainManagerCompatible === true) {
      return null;
    } else {
      return this.apiGateway.createRestApi({
        name: this.restApiName,
        description: 'Generated by the shared Serverless - AWS Api Gateway plugin',
        endpointConfiguration: {
          types: [
            'EDGE'
          ]
        }
      }).promise()
    }
  }

  deleteRestApi() {
    this.initialSetup()
    return null
  }

  _sourceArnReplaceRestApi(arr) {
    return arr.map(item => {
      if (Array.isArray(item)) return this._sourceArnReplaceRestApi(item)
      if (item && item.Ref && item.Ref === this.apiGatewayRestApiLogicalId) return this.restApiId
      else if (item && item['Fn::GetAtt']) return this.restApiResourceId
      return item
    })
  }



  _updateReferencesInCloudFormation() {
    const plugin = this.serverless.pluginManager.plugins.find(plugin => plugin.apiGatewayRestApiLogicalId)
    this.apiGatewayRestApiLogicalId = plugin && plugin.apiGatewayRestApiLogicalId

    // Set restApiId on provider
    this.serverless.service.provider.apiGatewayRestApiId = this.restApiId

    // Set restApiResourceId on provider
    this.serverless.service.provider.restApiResourceId = this.restApiResourceId

    let ccfTemplate = this.serverless.service.provider.compiledCloudFormationTemplate
    let Resources = ccfTemplate.Resources

    // Remove ApiGatewayRestApi
    if (Resources.ApiGatewayRestApi) delete Resources.ApiGatewayRestApi

    // Set restApiId on custom domain names
    if (Resources.pathmapping) Resources.pathmapping.Properties.RestApiId = this.restApiId

    if (this.apiGatewayRestApiLogicalId) {
      Object.keys(Resources).forEach(key => {
        if (/^ApiGateway(Resource|Method|Deployment)/.test(key)) {
          let Properties = Resources[key].Properties
          // Set restApiId on each Resource, Method, & Deployment
          if (Properties && Properties.RestApiId && Properties.RestApiId.Ref && Properties.RestApiId.Ref === this.apiGatewayRestApiLogicalId) Properties.RestApiId = this.restApiId
          // Set restApiResourceId as ParentId
          if (Properties && Properties.ParentId && Properties.ParentId['Fn::GetAtt']) Properties.ParentId = this.restApiResourceId
        } else if (/.+?LambdaPermissionApiGateway$/.test(key)) {
          Resources[key].Properties.SourceArn['Fn::Join'] = this._sourceArnReplaceRestApi(Resources[key].Properties.SourceArn['Fn::Join'])
        }
      })
    }

    // Set restApiId on Outputs
    if (ccfTemplate.Outputs && ccfTemplate.Outputs.ServiceEndpoint && ccfTemplate.Outputs.ServiceEndpoint.Value) {
      ccfTemplate.Outputs.ServiceEndpoint.Value['Fn::Join'] = this._sourceArnReplaceRestApi(ccfTemplate.Outputs.ServiceEndpoint.Value['Fn::Join'])
    }
  }

  async compileEvents() {
    this.restApiId = this.serverless.service.provider.apiGatewayRestApiId
    this.restApiResourceId = this.serverless.service.provider.apiGatewayRestApiResourceId
    this.restApiName = this.serverless.service.custom.sharedGateway.gatewayName
    this.outputResources = this.serverless.service.custom.sharedGateway.outputResources
    this.outputFilename = this.serverless.service.custom.sharedGateway.outputFilename
    this.domainManagerCompatible = this.serverless.service.custom.sharedGateway.domainManagerCompatible

    if (!this.restApiId && !this.restApiName) throw new Error(`Unable to continue please provide an apiId or apiName`);

    if (this.domainManagerCompatible === true) {
      this.serverless.cli.consoleLog('Serverless: Shared Gateway - Domain Manager hook is enabled')
      await this.grabRestID()
    } else {
      await this.findRestApi()
      await this.loadResourcesForApi()
      await this.findRootResourceId()
      await this._updateReferencesInCloudFormation()
      await this._findAndRemoveExistingResources()
    }

    if (this.outputResources === true) {
      
      if (this.outputFilename === undefined) {
        this.outputFilename = '.output'
      } 
  
      return await writeFile(`./${this.outputFilename}`, `restId=${this.restApiId}\nresourceId=${this.restApiResourceId} `)
    }

  }

  async loadResourcesForApi() {
    let hasMoreResults = true
    let currentPosition = null
    this.resources = []
    do {
      const {
        position,
        items
      } = await this.apiGateway.getResources({
        position: currentPosition,
        restApiId: this.restApiId,
        limit: 500
      }).promise()
      this.resources = this.resources.concat(items)
      currentPosition = position
      hasMoreResults = position && items.length === 500
    } while (hasMoreResults)
  }

  _findMatchingRestApi(api) {
    if (this.restApiId) return api.id === this.restApiId
    else if (this.restApiName) return api.name === this.restApiName
    return false
  }

  async findRestApi() {
    this.initialSetup()

    const {
      items
    } = await this.apiGateway.getRestApis({}).promise()
    if (!Array.isArray(items)) return

    if (this.restApiName) {
      let matchingRestApis = items.filter(api => this._findMatchingRestApi(api))
      if (matchingRestApis && matchingRestApis.length > 1) throw new Error(`Found multiple APIs with the name: ${this.restApiName}. Please rename your api or specify an apiGatewayRestApiId`)
      let provider = this.serverless.getProvider('aws')
      if (provider) provider.naming.getApiGatewayName = () => this.restApiName
    }

    let matchingRestApi = items.find(api => this._findMatchingRestApi(api))

    if (this.domainManagerCompatible === true) {
      this.serverless.cli.log(`Usign the compatibility driver ${this.restApiName} `)
    } else {
      if (this.restApiName && !matchingRestApi) {
        this.serverless.cli.log(`No API Gateway matching ${this.restApiName} attempting to create it.`)
        matchingRestApi = await this.createRestApi()
      }
      this.restApiId = matchingRestApi.id
      this.restApiName = matchingRestApi.name
    }
  }


  async grabRestID() {
    this.initialSetup()
    const { items } = await this.apiGateway.getRestApis({}).promise(); 
    let gatewayIds = items.filter(gateway => this._findMatchingRestApi(gateway))
    this.restApiId = gatewayIds[0].id
  }
  
  findExistingResources() {
    if (!this.resources) throw new Error(`You must have a list of the current resources. Did you forget to run loadResourcesForApi?`)

    const Resources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources
    return Object.keys(Resources).reduce((arr, key) => {
      const item = Resources[key]
      if (item.Type === 'AWS::ApiGateway::Resource') {
        const match = this.resources.find(r => r.pathPart === item.Properties.PathPart && r.parentId === item.Properties.ParentId) || null
        if (match) arr.push({
          key,
          id: match.id,
          parentId: match.parentId
        })
      }
      return arr
    }, [])
  }

  _findAndRemoveExistingResources() {
    const existingResources = this.findExistingResources()
    const Resources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources

    // Remove existing resources from the cloud formation
    existingResources.forEach(er => {
      delete Resources[er.key]
    })

    // Update the remaining resources to point to the existing resource
    Object.keys(Resources).forEach(key => {
      let item = Resources[key]
      if (item.Type === 'AWS::ApiGateway::Resource') {
        let ref = item.Properties.ParentId && item.Properties.ParentId.Ref
        let match = existingResources.find(er => er.key === ref)
        if (match) item.Properties.ParentId = match.id
      }
    })
  }

  findRootResourceId() {
    this.initialSetup()
    if (!this.restApiId) throw new Error(`You must have a restApiId. Did you forget to run findRestApi?`)
    if (!this.resources) throw new Error(`You must have a list of the current resources. Did you forget to run loadResourcesForApi?`)
    let matchingResource = this.resources.find(resource => this.restApiResourceId ? resource.id === this.restApiResourceId : resource.path === '/')
    if (!matchingResource) throw new Error('Unable to find a matching API Gateway resource. Please check the id and try again.')
    this.restApiResourceId = matchingResource.id

    // Root ID resource should be set here into a global access variable ++
  }

  summary() {
    this.serverless.cli.consoleLog('Serverless Shared Gateway - api name created ' + this.restApiName)
    if (this.restApiId) {
      this.serverless.cli.consoleLog('Serverless Shared Gateway - api id created ' + this.restApiId)
    }
  }
}

module.exports = sls_shared_api_gateway
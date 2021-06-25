import * as cdk from '@aws-cdk/core';
import * as route53 from '@aws-cdk/aws-route53';
import * as s3 from '@aws-cdk/aws-s3';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as s3deploy from '@aws-cdk/aws-s3-deployment';
import * as acm  from '@aws-cdk/aws-certificatemanager';
import * as targets from '@aws-cdk/aws-route53-targets/lib';

interface CompiledSettings {
    getSettingsValue: (settingsKey: string) => string,
    reactBuildDir: string
}

const compileSettings = (stack: cdk.Stack): CompiledSettings => {
    const node = stack.node;
    const defaultEnvironment = node.tryGetContext("environment");
    const reactBuildDir = node.tryGetContext("reactBuildDir");
    const defaultDomainName = node.tryGetContext("defaultDomainName");
    const defaultHostedZoneId = node.tryGetContext("defaultHostedZoneId");

    const environmentSettings = new cdk.CfnMapping(stack, 'environmentSettings', {
        mapping: {
            dev: {
                domainName: defaultDomainName,
                siteSubDomain: 'dev',
                hostedZoneId: defaultHostedZoneId,
            },
            staging: {
                domainName: defaultDomainName,
                siteSubDomain: 'staging',
                hostedZoneId: defaultHostedZoneId,
            },
            prod: {
                domainName: defaultDomainName,
                siteSubDomain: 'prod',
                hostedZoneId: defaultHostedZoneId,
            },
        },
    });

    const parameters = new cdk.CfnParameter(stack, 'environmentName', { 
        default: defaultEnvironment,
        allowedValues: ['dev', 'staging', 'prod'],
        description: 'Chose environment for deployment'
     });
    const getSettingsValue = (settingsKey: string): string => environmentSettings.findInMap(parameters.valueAsString, settingsKey);

    return {
        reactBuildDir,
        getSettingsValue,
    }
};


class CdkStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        const {
            reactBuildDir,
            getSettingsValue,
        } = compileSettings(this);

        const domainName = getSettingsValue('domainName');
        const siteSubDomain = getSettingsValue('siteSubDomain');
        const siteDomain = siteSubDomain + '.' + domainName;
        // cdk.Tags.of(scope).add('siteItems', siteDomain);
        
        const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
            hostedZoneId: getSettingsValue('hostedZoneId'),
            zoneName: domainName, 
        });
        new cdk.CfnOutput(this, 'Site', { value: 'https://' + siteDomain });

        const siteBucket = new s3.Bucket(this, 'SiteBucket', {
            bucketName: siteDomain,
            websiteIndexDocument: 'index.html',
            websiteErrorDocument: 'index.html',
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            publicReadAccess: false,
            // ToDo use parametrazied source
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            // ToDo use parametrazied source
            autoDeleteObjects: true,
        });
        new cdk.CfnOutput(this, 'Bucket', { value: siteBucket.bucketName });

        const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
            // Certifiacate will be created for all subdomains
            domainName: siteDomain,
            hostedZone: zone,
            region: this.region,
        });

        const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OIA', {
            comment: "Created by CDK"
          });

        // CloudFront distribution that provides HTTPS
        const distribution = new cloudfront.CloudFrontWebDistribution(this, 'SiteDistribution', {
            enableIpV6: true,
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
            aliasConfiguration: {
                acmCertRef: certificate.certificateArn,
                names: [ siteDomain ],
                sslMethod: cloudfront.SSLMethod.SNI,
                securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016,
            },
            errorConfigurations: [
                {
                    // React application should handle errors in own code
                    errorCode: 403,
                    responseCode: 200,
                    errorCachingMinTtl: 200,
                    responsePagePath: '/index.html'
                }
            ],
            originConfigs: [
                {
                    s3OriginSource: {
                        s3BucketSource: siteBucket,
                        originAccessIdentity,
                    },   
                    behaviors : [ {isDefaultBehavior: true}],
                }
            ]
        });
        
        new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });

        // Route53 alias record for the CloudFront distribution
        new route53.ARecord(this, 'SiteAliasRecord', {
            recordName: siteDomain,
            target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
            zone
        });

        // Deploy site contents to S3 bucket
        new s3deploy.BucketDeployment(this, 'DeployWithInvalidation', {
            sources: [ s3deploy.Source.asset(reactBuildDir) ],
            destinationBucket: siteBucket,
            distribution,
            distributionPaths: ['/*'], 
        });
    }
}

const app = new cdk.App();

new CdkStack(app, 'StaticSite', {
    env: {
        region: 'us-east-1',
    }
});

app.synth();

export default CdkStack;
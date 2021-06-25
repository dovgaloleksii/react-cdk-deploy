import * as cdk from '@aws-cdk/core';
import * as route53 from '@aws-cdk/aws-route53';
import * as s3 from '@aws-cdk/aws-s3';

interface CompiledSettings {
    getSettingsValue: (settingsKey: string) => string,
    removalPolicy: cdk.RemovalPolicy,
}

const compileSettings = (stack: cdk.Stack): CompiledSettings => {
    const node = stack.node;
    const defaultEnvironment = node.tryGetContext("environment");

    const environmentSettings = new cdk.CfnMapping(stack, 'environmentSettings', {
        mapping: {
            dev: {
                domainName: 'test.pro',
                siteSubDomain: '5DE4B68',
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            },
            staging: {
                domainName: 'test.pro',
                siteSubDomain: 'staging',
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            },
            prod: {
                domainName: 'test.pro',
                siteSubDomain: 'prod',
                removalPolicy: cdk.RemovalPolicy.RETAIN,
            },
        },
    });

    const parameters = new cdk.CfnParameter(stack, 'environmentName', { default: defaultEnvironment });
    const getSettingsValue = (settingsKey: string): string => environmentSettings.findInMap(parameters.valueAsString, settingsKey);

    // ToDo tokenize removalPolicy
    const removalPolicy = cdk.RemovalPolicy[getSettingsValue('removalPolicy') as keyof typeof cdk.RemovalPolicy]

    return {
        getSettingsValue,
        removalPolicy,
    }
}


class CdkStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        const {
            removalPolicy,
            getSettingsValue
        } = compileSettings(this);

        const domainName = getSettingsValue('domainName');
        const siteSubDomain = getSettingsValue('siteSubDomain');
        const siteDomain = siteSubDomain + '.' + domainName;
        cdk.Tags.of(scope).add('siteItems', siteDomain)
        

        // const zone = new route53.HostedZone(this, 'Zone', { zoneName: domainName });
        new cdk.CfnOutput(this, 'Site', { value: 'https://' + siteDomain });

        const siteBucket = new s3.Bucket(this, 'SiteBucket', {
            bucketName: siteDomain,
            websiteIndexDocument: 'index.html',
            websiteErrorDocument: 'index.html',
            publicReadAccess: false,
            removalPolicy,
        });

    }
}

const app = new cdk.App();

new CdkStack(app, 'StaticSite', {
    env: {
        account: 'default',
        region: 'us-east-1',
    }
});

app.synth();

export default CdkStack;
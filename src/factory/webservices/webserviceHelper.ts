import fetch, {Response} from 'node-fetch'
import * as https from 'https';
import { XmlHelper } from '../xmlHelper'
import { RetornoProcessamento } from '../interface/nfe'

export interface WebProxy {
    host: string
    port: string
    isHttps?: boolean
    auth?: {
        username: string
        password: string
    }
}

function proxyToUrl(pr: WebProxy): string {
    const server = `${pr.host}:${pr.port}`
    let auth = null;
    let final = pr.isHttps ? 'https://' : 'http://'
    if(pr.auth) {
        final = `${final}${pr.auth.username}:${pr.auth.password}@`
    }

    return `${final}${server}`
}

export abstract class WebServiceHelper {

    private static getByLocalName(value: any, localName: string): any {
        if (!value || typeof value !== 'object') return undefined;
        const key = Object.keys(value).find(currentKey => currentKey.split(':').pop() === localName);
        return key ? value[key] : undefined;
    }

    private static findByLocalName(value: any, localName: string): any {
        if (!value || typeof value !== 'object') return undefined;

        const directValue = this.getByLocalName(value, localName);
        if (directValue !== undefined) return directValue;

        for (const child of Object.values(value)) {
            const result = this.findByLocalName(child, localName);
            if (result !== undefined) return result;
        }

        return undefined;
    }

    public static extractSoapResult(retorno: any): any {
        const envelope = this.getByLocalName(retorno, 'Envelope');
        if (!envelope) throw new Error('Resposta SOAP inválida: Envelope não encontrado.');

        const body = this.getByLocalName(envelope, 'Body');
        if (!body) throw new Error('Resposta SOAP inválida: Body não encontrado.');

        const result = this.findByLocalName(body, 'nfeResultMsg');
        if (result === undefined) throw new Error('Resposta SOAP inválida: nfeResultMsg não encontrado.');

        return result;
    }

    public static buildSoapEnvelope(xml: string, soapMethod: string) {
        let soapEnvelopeObj = {
            '$': { 'xmlns:soap': 'http://www.w3.org/2003/05/soap-envelope',
                    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                    'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema' },
                'soap:Body': {
                    'nfeDadosMsg': {
                        '$': {
                            'xmlns': soapMethod
                        },
                        _: '[XML]'
                    }
                }
            };

        let soapEnvXml = XmlHelper.serializeXml(soapEnvelopeObj, 'soap:Envelope');
        return soapEnvXml.replace('[XML]', xml);
    }

    public static async makeSoapRequest(xml: string, cert: any, soap: any,  proxy?: WebProxy) {
        let result = <RetornoProcessamento>{ xml_enviado: xml };
        try {
            const options = {
                method: 'POST',
                headers: {
                    "Content-Type": soap.contentType,
                    "SOAPAction": soap.action
                },
                agent: new https.Agent({
                    rejectUnauthorized: false,
                    // pfx: cert.pfx,
                    cert: cert.pem,
                    key: cert.key,
                    passphrase: cert.password,
                }),
                body: this.buildSoapEnvelope(xml, soap.method),
            }

            const res = await fetch(soap.url, options);
            result.status = res.status;
            result.xml_recebido = await res.text();

            if (result.status == 200) {
                result.success = true;
                let retorno = XmlHelper.deserializeXml(result.xml_recebido, {explicitArray: false});
                if (retorno) {
                    result.data = this.extractSoapResult(retorno);
                }
            }
            return result;

        } catch (err: any) {
            result.success = false;
            result.error = err;
            return result;
        }
    }
}

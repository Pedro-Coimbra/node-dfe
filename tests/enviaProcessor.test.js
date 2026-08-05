const assert = require('assert');
const { EnviaProcessor } = require('../lib/factory/processor/enviaProcessor');
const { ServicosSefaz } = require('../lib/factory/interface/nfe');
const { SefazNFCe } = require('../lib/factory/webservices/sefazNfce');
const { XmlHelper } = require('../lib/factory/xmlHelper');

const chave = '52260840156314000100650010000074981652432876';
const xmlLote = `<enviNFe><NFe><infNFe Id="NFe${chave}"></infNFe></NFe></enviNFe>`;

const criarConfiguracoes = (uf = 'GO', tentativas = 3) => ({
	empresa: { endereco: { uf } },
	certificado: {},
	geral: { versao: '4.00', modelo: '65', ambiente: '1' },
	webservices: { tentativas, aguardarConsultaRetorno: 1 }
});

const criarRetornoAutorizado = () => ({
	success: true,
	xml_enviado: '<consSitNFe/>',
	xml_recebido: `<retConsSitNFe><protNFe><infProt><cStat>100</cStat><chNFe>${chave}</chNFe></infProt></protNFe></retConsSitNFe>`,
	data: {
		retConsSitNFe: {
			cStat: '100',
			xMotivo: 'Autorizado o uso da NF-e',
			protNFe: { infProt: { cStat: '100', chNFe: chave } }
		}
	}
});

async function deveRecuperarAutorizacaoAposRespostaIncerta() {
	const ufsRepresentativas = ['GO', 'MT', 'AC'];
	for (const uf of ufsRepresentativas) {
		const processor = new EnviaProcessor(criarConfiguracoes(uf));
		processor.enviarNF = async () => ({
			success: false,
			xml_enviado: xmlLote,
			error: new Error('timeout')
		});

		let consultas = 0;
		processor.consultarProtocolo = async chaveConsultada => {
			assert.strictEqual(chaveConsultada, chave);
			consultas++;
			if (consultas === 1) {
				return {
					success: true,
					data: { retConsSitNFe: { cStat: '217', xMotivo: 'NF-e não consta' } }
				};
			}
			return criarRetornoAutorizado();
		};

		const result = await processor.transmitirXml(xmlLote, {});

		assert.strictEqual(result.success, true);
		assert.strictEqual(consultas, 2);
		assert.strictEqual(result.envioNF.xml_enviado, xmlLote);
		assert.strictEqual(result.envioNF.data.retEnviNFe.protNFe.infProt.chNFe, chave);
		assert.match(result.envioNF.xml_recebido, /<protNFe>/);
	}
}

async function devePreservarEnvioQuandoNaoRecuperarAutorizacao() {
	const processor = new EnviaProcessor(criarConfiguracoes('GO', 1));
	const retornoOriginal = {
		success: false,
		xml_enviado: xmlLote,
		error: new Error('timeout')
	};
	processor.enviarNF = async () => retornoOriginal;
	processor.consultarProtocolo = async () => ({
		success: true,
		data: { retConsSitNFe: { cStat: '217' } }
	});

	const result = await processor.transmitirXml(xmlLote, {});

	assert.strictEqual(result.success, false);
	assert.strictEqual(result.envioNF, retornoOriginal);
}

async function naoDeveConsultarProtocoloAposRejeicaoFiscal() {
	const processor = new EnviaProcessor(criarConfiguracoes('GO'));
	const retornoRejeitado = {
		success: true,
		data: {
			retEnviNFe: {
				cStat: '104',
				protNFe: { infProt: { cStat: '539', xMotivo: 'Duplicidade de NF-e' } }
			}
		}
	};
	processor.enviarNF = async () => retornoRejeitado;
	processor.consultarProtocolo = async () => {
		throw new Error('A consulta não deveria ser executada para uma rejeição fiscal');
	};

	const result = await processor.transmitirXml(xmlLote, {});

	assert.strictEqual(result.success, true);
	assert.strictEqual(result.envioNF, retornoRejeitado);
}

function deveTerEndpointDeConsultaEmTodosOsAutorizadores() {
	const ufsPorAutorizador = ['AM', 'CE', 'GO', 'MT', 'MS', 'MG', 'PR', 'RS', 'SP', 'AC'];
	for (const uf of ufsPorAutorizador) {
		for (const ambiente of ['1', '2']) {
			const soapConsulta = SefazNFCe.getSoapInfo(uf, ambiente, ServicosSefaz.protocolo);
			assert.match(soapConsulta.url, /^https:\/\//);
			assert.match(soapConsulta.url, /\?wsdl$/);
		}
	}
}

function deveGerarGrupoMonofasicoRetidoAnteriormente() {
	const processor = new EnviaProcessor(criarConfiguracoes('MA'));
	const imposto = processor.getImpostoIBSCBS({
		CST: '620',
		cClassTrib: '620006',
		gIBSCBSMono: {
			gMonoRet: {
				qBCMonoRet: '13.0000',
				adRemIBSRet: '0.0000',
				vIBSMonoRet: '0.00',
				adRemCBSRet: '0.0000',
				vCBSMonoRet: '0.00',
			},
			vTotIBSMonoItem: '0.00',
			vTotCBSMonoItem: '0.00',
		},
	});

	assert.deepStrictEqual(imposto, {
		CST: '620',
		cClassTrib: '620006',
		gIBSCBSMono: {
			gMonoRet: {
				qBCMonoRet: '13.0000',
				adRemIBSRet: '0.0000',
				vIBSMonoRet: '0.00',
				adRemCBSRet: '0.0000',
				vCBSMonoRet: '0.00',
			},
			vTotIBSMonoItem: '0.00',
			vTotCBSMonoItem: '0.00',
		},
	});
	assert.strictEqual(imposto.gIBSCBSMono.gMonoPadrao, undefined);
	const xml = XmlHelper.serializeXml(imposto, 'IBSCBS');
	assert.match(xml, /<gMonoRet><qBCMonoRet>13\.0000<\/qBCMonoRet>/);
	assert.doesNotMatch(xml, /<gMonoPadrao>/);
}

Promise.resolve()
	.then(deveTerEndpointDeConsultaEmTodosOsAutorizadores)
	.then(deveGerarGrupoMonofasicoRetidoAnteriormente)
	.then(deveRecuperarAutorizacaoAposRespostaIncerta)
	.then(devePreservarEnvioQuandoNaoRecuperarAutorizacao)
	.then(naoDeveConsultarProtocoloAposRejeicaoFiscal)
	.then(() => console.log('Testes unitários do EnviaProcessor concluídos com sucesso.'))
	.catch(error => {
		console.error(error);
		process.exitCode = 1;
	});

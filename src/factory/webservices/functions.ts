export function getContentType(uf: string): string {
    switch (uf) {
        case 'GO':
        case 'MG':
            return "application/soap+xml";
        default:
            return "text/xml;charset=utf-8";
    }
}


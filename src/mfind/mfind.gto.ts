// src/mfind/dto/mfind.dto.ts
export class MFindDto {

    
    appName: string;
    moduleName: string;

    query?: any;
    projection?: any;
    limit?: number;
    skip?: number;
    order?: 'ascending' | 'descending';
    sortBy?: string;
    lookups?: any[];
    companyId?: string;
    tableType?: string;
}

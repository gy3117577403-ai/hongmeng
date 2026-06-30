export type WorkOrderDTO={id:string;code:string;productName:string;stage:string;progress:number;priority:string;status:string;createdAt:string;updatedAt:string};
export type ResourceCategoryDTO={id:string;name:string;code:string;sortOrder:number};
export type ResourceFileDTO={id:string;workOrderId:string;categoryId:string;originalName:string;mimeType:string;fileType:string;fileSize:number;version:string;status:string;uploadedBy?:string|null;createdAt:string;updatedAt:string;viewUrl:string;downloadUrl:string};
export type CurrentUserDTO={id:string;username:string;displayName:string};

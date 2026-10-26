export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantScopedEntity extends BaseEntity {
  tenantId: string;
}

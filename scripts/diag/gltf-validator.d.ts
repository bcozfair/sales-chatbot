// type ของ gltf-validator (Khronos · แพ็กเกจไม่มี .d.ts มาให้) — ประกาศเท่าที่ diag:drawing-glb ใช้
declare module 'gltf-validator' {
  interface ValidationMessage { code: string; message: string; severity: number; pointer?: string; offset?: number }
  interface ValidationReport {
    validatorVersion: string;
    issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: ValidationMessage[]; truncated: boolean };
  }
  const validator: {
    validateBytes(data: Uint8Array, options?: { uri?: string; format?: 'glb' | 'gltf'; maxIssues?: number }): Promise<ValidationReport>;
    version(): string;
  };
  export = validator;
}

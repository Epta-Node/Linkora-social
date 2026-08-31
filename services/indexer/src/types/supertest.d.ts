declare module "supertest" {
  const request: (app: unknown) => {
    get(path: string): Promise<{ status: number; body: unknown }>;
    post(path: string): {
      send(body: unknown): Promise<{ status: number; body: unknown }>;
    };
  };

  export default request;
}

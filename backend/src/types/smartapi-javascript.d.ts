declare module 'smartapi-javascript' {
  export class SmartAPI {
    constructor(config: {
      api_key: string;
      access_token?: string;
    });
    
    generateSession(clientCode: string, password: string, totp: string): Promise<{
      status: boolean;
      message: string;
      data: {
        jwtToken: string;
        refreshToken: string;
        feedToken: string;
      };
    }>;
    
    generateToken(refreshToken: string): Promise<any>;
    getProfile(): Promise<any>;
    placeOrder(orderParams: any): Promise<any>;
    modifyOrder(orderParams: any): Promise<any>;
    cancelOrder(variety: string, orderId: string): Promise<any>;
    getOrderBook(): Promise<any>;
    getTradeBook(): Promise<any>;
    getRMS(): Promise<any>;
    getHolding(): Promise<any>;
    getPosition(): Promise<any>;
    convertPosition(positionParams: any): Promise<any>;
  }
}

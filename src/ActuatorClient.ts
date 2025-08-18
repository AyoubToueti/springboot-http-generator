import axios from 'axios';
import { AppDetector } from './AppDetector';

export interface IActuatorMapping {
  contexts: {
    [key: string]: {
      mappings: {
        dispatcherServlets: {
          [key: string]: IDispatcherServlet[];
        };
      };
    };
  };
}

export interface IDispatcherServlet {
  details: {
    requestMappingConditions: {
      patterns: string[];
      methods: string[];
    };
  };
  handler: string;
}

export class ActuatorClient {
  public static async getMappings(): Promise<IDispatcherServlet[]> {
    try {
      const port = await AppDetector.getPort();
      const response = await axios.get<IActuatorMapping>(`http://localhost:${port}/actuator/mappings`);
      const mappings = response.data.contexts[Object.keys(response.data.contexts)[0]].mappings.dispatcherServlets;
      return mappings[Object.keys(mappings)[0]];
    } catch (error) {
      console.error('Failed to fetch actuator mappings:', error);
      return [];
    }
  }
}

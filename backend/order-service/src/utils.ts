/**
 * Utilities for Order Service
 */

import { APIGatewayProxyResult } from 'aws-lambda';

export function buildSuccessResponse(
  data: any,
  statusCode: number = 200
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: JSON.stringify(data),
  };
}

export function buildErrorResponse(
  statusCode: number,
  code: string,
  message: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: JSON.stringify({
      success: false,
      error: {
        code,
        message,
      },
    }),
  };
}

export function parseBody(body: string | null): any {
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Invalid JSON in request body');
  }
}

export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

export function validateRequired(obj: any, fields: string[]): void {
  for (const field of fields) {
    if (!obj[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

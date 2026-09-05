import { StockSourceType } from './generated/prisma/enums.js';

export const defaultStockSourceTypes = [
  StockSourceType.SEC,
  StockSourceType.INVESTOR_RELATIONS,
  StockSourceType.NEWS,
  StockSourceType.TRADINGVIEW_NEWS,
  StockSourceType.PRICE,
  StockSourceType.FINVIZ,
  StockSourceType.ZACKS,
  StockSourceType.EARNINGS_WHISPERS,
  StockSourceType.QUIVER_INSIDERS,
  StockSourceType.QUIVER_CONTRACTS,
  StockSourceType.QUIVER_PATENTS,
  StockSourceType.QUIVER_CONGRESS,
  StockSourceType.QUIVER_OFF_EXCHANGE,
  StockSourceType.QUIVER_LOBBYING,
  StockSourceType.ALPHA_VANTAGE_OPTIONS,
  StockSourceType.ALPHA_VANTAGE_INSTITUTIONAL,
  StockSourceType.FINRA_SHORT_INTEREST,
  StockSourceType.CLINICAL_TRIALS,
  StockSourceType.FDA,
];

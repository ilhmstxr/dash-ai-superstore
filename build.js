require('dotenv').config();
const fs = require('fs');
const path = require('path');

const configContent = `window.CONFIG = {
  OPENROUTER_API_KEY: '${process.env.OPENROUTER_API_KEY || ''}',
  OPENROUTER_MODEL:   '${process.env.OPENROUTER_MODEL || 'gemini-3-flash'}',

  SUPABASE_URL:      '${process.env.SUPABASE_URL || ''}',
  SUPABASE_ANON_KEY: '${process.env.SUPABASE_ANON_KEY || ''}',
  SUPABASE_TABLE:    '${process.env.SUPABASE_TABLE || 'davis'}',

  DATA_SOURCE: '${process.env.DATA_SOURCE || 'supabase'}',

  COLUMN_MAP: {
    order_id:        'SalesOrderID',
    order_date:      'OrderDate',
    tahun:           'tahun',
    bulan:           'bulan',
    ship_date:       'ShipDate',
    ship_method:     'ShipMethod',
    customer_id:     'CustomerID',
    customer_name:   'CustomerName',
    segment:         'Segment',
    country_region:  'CountryRegion',
    city:            'City',
    province:        'Province',
    postal_code:     'PostalCode',
    region:          'Territory',
    product_name:    'ProductName',
    category:        'Category',
    sub_category:    'SubCategory',
    qty:             'Qty',
    unit_price:      'UnitPrice',
    sales:           'Sales',
    discount:        'Discount',
    product_cost:    'ProductCost',
    total_cost:      'TotalCost',
    profit:          'Profit',
  },
};
`;

const configPath = path.join(__dirname, 'config.js');
fs.writeFileSync(configPath, configContent);
console.log('[build.js] config.js generated successfully!');

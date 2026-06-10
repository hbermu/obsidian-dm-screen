export interface WebhookExtraField {
  key: string;
  value: string;
}

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  imageField: string;
  captionField: string;
  extraFields: WebhookExtraField[];
}

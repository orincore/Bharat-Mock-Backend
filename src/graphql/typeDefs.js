const typeDefs = `#graphql
scalar Upload
scalar JSON

input ExamFilterInput {
  page: Int
  limit: Int
  search: String
  status: String
  category: String
  difficulty: String
  exam_type: String
}

input ExamInput {
  title: String!
  description: String
  duration: Int!
  total_marks: Int!
  total_questions: Int!
  category: String
  category_id: ID
  subcategory: String
  subcategory_id: ID
  difficulty: String
  difficulty_id: ID
  status: String
  start_date: String
  end_date: String
  pass_percentage: Float
  is_free: Boolean
  price: Float
  negative_marking: Boolean
  negative_mark_value: Float
  is_published: Boolean
  allow_anytime: Boolean
  exam_type: String
  show_in_mock_tests: Boolean
  slug: String
  syllabus: [String!]
}

input OptionInput {
  id: ID
  option_text: String!
  option_text_hi: String
  is_correct: Boolean!
  option_order: Int
  image_url: String
}

input QuestionInput {
  id: ID
  type: String!
  text: String!
  text_hi: String
  marks: Float!
  negative_marks: Float
  explanation: String
  explanation_hi: String
  difficulty: String!
  question_order: Int
  question_number: Int
  image_url: String
  options: [OptionInput!]
}

input SectionInput {
  id: ID
  name: String!
  name_hi: String
  language: String
  total_questions: Int
  marks_per_question: Float
  duration: Int
  section_order: Int
  questions: [QuestionInput!]
}

input DraftFieldInput {
  draft_key: String!
  exam_id: ID
  field_path: String!
  payload: JSON!
}

type Exam {
  id: ID!
  title: String!
  description: String
  duration: Int
  total_marks: Int
  total_questions: Int
  category: String
  category_id: ID
  subcategory: String
  subcategory_id: ID
  difficulty: String
  difficulty_id: ID
  status: String
  start_date: String
  end_date: String
  pass_percentage: Float
  is_free: Boolean
  price: Float
  negative_marking: Boolean
  negative_mark_value: Float
  is_published: Boolean
  allow_anytime: Boolean
  exam_type: String
  show_in_mock_tests: Boolean
  supports_hindi: Boolean
  logo_url: String
  thumbnail_url: String
  slug: String
  url_path: String
  syllabus: [String!]
  created_at: String
  updated_at: String
}

type Option {
  id: ID!
  option_text: String!
  option_text_hi: String
  is_correct: Boolean!
  option_order: Int
  image_url: String
}

type Question {
  id: ID!
  type: String!
  text: String!
  text_hi: String
  marks: Float
  negative_marks: Float
  explanation: String
  explanation_hi: String
  difficulty: String
  image_url: String
  question_order: Int
  question_number: Int
  options: [Option!]
}

type Section {
  id: ID!
  name: String!
  name_hi: String
  language: String
  total_questions: Int
  marks_per_question: Float
  duration: Int
  section_order: Int
  questions: [Question!]
}

type ExamList {
  data: [Exam!]!
  total: Int!
  totalPages: Int!
  page: Int!
  limit: Int!
}

type ExamPayload {
  exam: Exam!
  sections: [Section!]
}

type DraftField {
  id: ID!
  draft_key: String!
  exam_id: ID
  updated_by: ID
  field_path: String!
  payload: JSON!
  updated_at: String!
}

type UploadPayload {
  url: String!
}

type ImageUploadResponse {
  success: Boolean!
  imageUrl: String
  error: String
}

type Query {
  adminExams(filter: ExamFilterInput): ExamList!
  adminExam(id: ID!): Exam
  examStructure(examId: ID!): [Section!]!
  draftFields(draft_key: String!, exam_id: ID): [DraftField!]!
}

type Mutation {
  createExam(input: ExamInput!, sections: [SectionInput!]): ExamPayload!
  updateExam(id: ID!, input: ExamInput!, sections: [SectionInput!]): ExamPayload!
  deleteExam(id: ID!): Boolean!
  upsertDraftField(input: DraftFieldInput!): DraftField!
  clearDraft(draft_key: String!, exam_id: ID): Boolean!
  uploadFile(file: Upload!): UploadPayload!
  uploadQuestionImage(questionId: ID!, file: String!): ImageUploadResponse!
  uploadOptionImage(optionId: ID!, file: String!): ImageUploadResponse!
}
`;

module.exports = typeDefs;

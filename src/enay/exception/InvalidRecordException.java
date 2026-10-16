package enay.exception;

import enay.model.*;
import enay.validation.ValidationUtils;
import enay.exception.InvalidRecordException;
public class InvalidRecordException extends Exception {
    private static final long serialVersionUID = 1L;
    public InvalidRecordException(String message) {
        super(message);
    }
}
